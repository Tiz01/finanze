import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeBalances } from '../domain/balances';
import { buildBackup, parseBackup, serializeBackup } from '../domain/backup';
import { CATEGORY_IDS } from '../domain/categories';
import { pendingCount, pendingRecurring } from '../domain/recurring';
import { summarizePeriod } from '../domain/reports';
import { createAccount, deleteAccount, type AccountDraft } from './accounts';
import { deleteCategory } from './categories';
import { loadDemoData, readAllData } from './data';
import { db } from './db';
import { reconcileAccount } from './reconciliations';
import {
  confirmOccurrence,
  createRecurring,
  deleteRecurring,
  skipOccurrence,
  updateRecurring,
  type RecurringDraft,
} from './recurring';
import { addTransaction, deleteTransaction } from './transactions';

const today = '2026-10-30';

const accountDraft: AccountDraft = {
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 100000,
  initialBalanceDate: '2026-10-01',
  archived: false,
  contaComeLiquidita: true,
};

async function balanceOf(accountId: string, date = today): Promise<number> {
  return computeBalances(await db.accounts.toArray(), await db.transactions.toArray(), date).get(accountId) ?? 0;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('Aggiorna saldo reale', () => {
  it('se il saldo coincide salva la verifica senza rettifica', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 100000, createAdjustment: false });
    const [verification] = await db.reconciliations.toArray();
    expect(verification?.realBalanceCents).toBe(100000);
    expect(verification?.adjustmentId).toBeUndefined();
    expect(await db.transactions.count()).toBe(0);
  });

  it('crea una rettifica "Non tracciato" pari alla differenza, in meno e in più', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 98750, createAdjustment: true });
    expect(await balanceOf(accountId)).toBe(98750);
    const [adjustment] = await db.transactions.toArray();
    expect(adjustment?.type).toBe('rettifica');
    expect(adjustment?.amountCents).toBe(-1250);
    expect(adjustment?.categoryId).toBe(CATEGORY_IDS.nonTracciato);

    await reconcileAccount({ accountId, date: today, realBalanceCents: 99000, createAdjustment: true });
    expect(await balanceOf(accountId)).toBe(99000);
    expect(await db.transactions.count()).toBe(2);
  });

  it('collega la rettifica alla verifica', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 90000, createAdjustment: true });
    const [verification] = await db.reconciliations.toArray();
    const [adjustment] = await db.transactions.toArray();
    expect(verification?.adjustmentId).toBe(adjustment?.id);
  });

  it('senza rettifica rifiuta un saldo che non coincide e non salva nulla', async () => {
    const accountId = await createAccount(accountDraft);
    await expect(
      reconcileAccount({ accountId, date: today, realBalanceCents: 99999, createAdjustment: false }),
    ).rejects.toThrow(/non coincide/);
    expect(await db.reconciliations.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
  });

  it('calcola la differenza alla data della verifica', async () => {
    const accountId = await createAccount(accountDraft);
    await addTransaction({ date: '2026-10-20', amountCents: 5000, type: 'uscita', accountId, categoryId: 'cat-spesa' });
    await reconcileAccount({ accountId, date: '2026-10-10', realBalanceCents: 100000, createAdjustment: false });
    await reconcileAccount({ accountId, date: '2026-10-25', realBalanceCents: 95000, createAdjustment: false });
    expect(await db.reconciliations.count()).toBe(2);
    expect(await db.transactions.where('type').equals('rettifica').count()).toBe(0);
  });

  it('considera anche i trasferimenti in entrata e in uscita', async () => {
    const accountId = await createAccount(accountDraft);
    const otherId = await createAccount({ ...accountDraft, name: 'Altro', initialBalanceCents: 0 });
    await addTransaction({ date: today, amountCents: 30000, type: 'trasferimento', accountId, toAccountId: otherId });
    await reconcileAccount({ accountId: otherId, date: today, realBalanceCents: 30000, createAdjustment: false });
    await reconcileAccount({ accountId, date: today, realBalanceCents: 70000, createAdjustment: false });
    expect(await db.transactions.where('type').equals('rettifica').count()).toBe(0);
  });

  it('rifiuta date precedenti al saldo iniziale e conti inesistenti', async () => {
    const accountId = await createAccount(accountDraft);
    await expect(
      reconcileAccount({ accountId, date: '2026-09-01', realBalanceCents: 1, createAdjustment: true }),
    ).rejects.toThrow(/precedente/);
    await expect(
      reconcileAccount({ accountId: 'x', date: today, realBalanceCents: 1, createAdjustment: true }),
    ).rejects.toThrow(/non esiste/);
  });

  it('l’annullamento toglie verifica e rettifica', async () => {
    const accountId = await createAccount(accountDraft);
    const undo = await reconcileAccount({ accountId, date: today, realBalanceCents: 90000, createAdjustment: true });
    await undo();
    expect(await db.reconciliations.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    expect(await balanceOf(accountId)).toBe(100000);
  });

  it('la rettifica compare nel risparmio del mese, non tra le uscite', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 97500, createAdjustment: true });
    const summary = summarizePeriod(await db.transactions.toArray(), '2026-10-01', today);
    expect(summary.adjustmentCents).toBe(-2500);
    expect(summary.expenseCents).toBe(0);
    expect(summary.savingsCents).toBe(-2500);
  });

  it('eliminando la rettifica la verifica resta senza collegamento; annullando torna tutto', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 90000, createAdjustment: true });
    const [adjustment] = await db.transactions.toArray();
    const undo = await deleteTransaction(adjustment!.id);
    expect((await db.reconciliations.toArray())[0]?.adjustmentId).toBeUndefined();
    await undo();
    expect((await db.reconciliations.toArray())[0]?.adjustmentId).toBe(adjustment!.id);
    expect(await balanceOf(accountId)).toBe(90000);
  });

  it('un conto con verifiche non si può eliminare', async () => {
    const accountId = await createAccount(accountDraft);
    await reconcileAccount({ accountId, date: today, realBalanceCents: 100000, createAdjustment: false });
    await expect(deleteAccount(accountId)).rejects.toThrow(/archiviarlo/);
  });
});

describe('ricorrenze', () => {
  async function affitto(fields: Partial<RecurringDraft> = {}) {
    const accountId = await createAccount(accountDraft);
    const id = await createRecurring({
      name: '  Affitto ',
      frequency: 'mensile',
      anchorDate: '2026-08-31',
      active: true,
      template: { type: 'uscita', amountCents: 50000, accountId, categoryId: 'cat-casa' },
      ...fields,
    });
    return { id, accountId };
  }

  it('alla creazione la prossima scadenza è la prima', async () => {
    const { id } = await affitto();
    const saved = await db.recurring.get(id);
    expect(saved?.name).toBe('Affitto');
    expect(saved?.nextDue).toBe('2026-08-31');
  });

  it('non crea mai movimenti da sola', async () => {
    const { id } = await affitto();
    const pending = pendingRecurring(await db.recurring.toArray(), today);
    expect(pending[0]?.recurring.id).toBe(id);
    expect(pendingCount(pending)).toBe(2);
    expect(await db.transactions.count()).toBe(0);
  });

  it('confermare crea il movimento con la data della scadenza e passa alla successiva', async () => {
    const { id, accountId } = await affitto();
    await confirmOccurrence(id, '2026-08-31');
    const [movement] = await db.transactions.toArray();
    expect(movement).toMatchObject({ date: '2026-08-31', amountCents: 50000, type: 'uscita', accountId, categoryId: 'cat-casa', recurringId: id, note: 'Affitto' });
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-09-30');
  });

  it('la scadenza successiva torna al giorno originale dopo un mese più corto', async () => {
    const { id } = await affitto();
    await confirmOccurrence(id, '2026-08-31');
    await confirmOccurrence(id, '2026-09-30');
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-10-31');
  });

  it('confermare con modifiche usa i dati modificati solo per quel movimento', async () => {
    const { id, accountId } = await affitto();
    await confirmOccurrence(id, '2026-08-31', {
      date: '2026-09-02',
      amountCents: 51000,
      type: 'uscita',
      accountId,
      categoryId: 'cat-casa',
      note: 'Con conguaglio',
    });
    const [movement] = await db.transactions.toArray();
    expect(movement).toMatchObject({ date: '2026-09-02', amountCents: 51000, note: 'Con conguaglio', recurringId: id });
    const saved = await db.recurring.get(id);
    expect(saved?.template.amountCents).toBe(50000);
    expect(saved?.nextDue).toBe('2026-09-30');
  });

  it('saltare passa alla scadenza successiva senza creare movimenti', async () => {
    const { id } = await affitto();
    await skipOccurrence(id, '2026-08-31');
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-09-30');
    expect(await db.transactions.count()).toBe(0);
  });

  it('la stessa scadenza non si può gestire due volte', async () => {
    const { id } = await affitto();
    await confirmOccurrence(id, '2026-08-31');
    await expect(confirmOccurrence(id, '2026-08-31')).rejects.toThrow(/già stata gestita/);
    await expect(skipOccurrence(id, '2026-08-31')).rejects.toThrow(/già stata gestita/);
    expect(await db.transactions.count()).toBe(1);
  });

  it('annullare riporta tutto com’era', async () => {
    const { id } = await affitto();
    const undoConfirm = await confirmOccurrence(id, '2026-08-31');
    await undoConfirm();
    expect(await db.transactions.count()).toBe(0);
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-08-31');

    const undoSkip = await skipOccurrence(id, '2026-08-31');
    await undoSkip();
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-08-31');
  });

  it('un trasferimento ricorrente verso l’investimento non è una spesa', async () => {
    const accountId = await createAccount(accountDraft);
    const brokerId = await createAccount({ ...accountDraft, name: 'Broker', type: 'investimento', contaComeLiquidita: false, initialBalanceCents: 0 });
    const id = await createRecurring({
      name: 'PAC',
      frequency: 'mensile',
      anchorDate: today,
      active: true,
      template: { type: 'trasferimento', amountCents: 10000, accountId, toAccountId: brokerId },
    });
    await confirmOccurrence(id, today);
    expect(await balanceOf(brokerId)).toBe(10000);
    expect(summarizePeriod(await db.transactions.toArray(), '2026-10-01', today).expenseCents).toBe(0);
  });

  it('rifiuta ricorrenze non valide', async () => {
    const accountId = await createAccount(accountDraft);
    const valid: RecurringDraft = {
      name: 'X',
      frequency: 'mensile',
      anchorDate: today,
      active: true,
      template: { type: 'uscita', amountCents: 100, accountId, categoryId: 'cat-casa' },
    };
    await expect(createRecurring({ ...valid, name: ' ' })).rejects.toThrow(/nome/);
    await expect(createRecurring({ ...valid, anchorDate: 'ieri' })).rejects.toThrow(/Data/);
    await expect(createRecurring({ ...valid, template: { ...valid.template, amountCents: 0 } })).rejects.toThrow();
    await expect(createRecurring({ ...valid, template: { ...valid.template, categoryId: undefined } })).rejects.toThrow(/categoria/);
    await expect(createRecurring({ ...valid, frequency: 'personalizzata', interval: 0, intervalUnit: 'giorni' })).rejects.toThrow(/intervallo/i);
  });

  it('modificare l’importo non sposta la prossima scadenza', async () => {
    const { id, accountId } = await affitto();
    await confirmOccurrence(id, '2026-08-31');
    const saved = (await db.recurring.get(id))!;
    await updateRecurring(id, {
      name: saved.name,
      frequency: saved.frequency,
      anchorDate: saved.anchorDate,
      active: true,
      template: { type: 'uscita', amountCents: 52000, accountId, categoryId: 'cat-casa' },
    });
    const updated = await db.recurring.get(id);
    expect(updated?.template.amountCents).toBe(52000);
    expect(updated?.nextDue).toBe('2026-09-30');
  });

  it('cambiando frequenza riparte dalla prima scadenza non ancora gestita', async () => {
    const { id, accountId } = await affitto({ anchorDate: '2026-01-10' });
    await db.recurring.update(id, { nextDue: '2026-10-10' });
    await updateRecurring(id, {
      name: 'Affitto',
      frequency: 'personalizzata',
      interval: 3,
      intervalUnit: 'mesi',
      anchorDate: '2026-01-10',
      active: true,
      template: { type: 'uscita', amountCents: 50000, accountId, categoryId: 'cat-casa' },
    });
    expect((await db.recurring.get(id))?.nextDue).toBe('2026-10-10');
  });

  it('conti e categorie usati da una ricorrenza non si eliminano finché c’è', async () => {
    const { id, accountId } = await affitto();
    await expect(deleteAccount(accountId)).rejects.toThrow(/ricorrenza/);
    await expect(deleteCategory('cat-casa')).rejects.toThrow(/ricorrenza/);
    await deleteRecurring(id);
    await deleteCategory('cat-casa');
    await deleteAccount(accountId);
    expect(await db.accounts.get(accountId)).toBeUndefined();
  });

  it('eliminare una ricorrenza non tocca i movimenti già creati', async () => {
    const { id } = await affitto();
    await confirmOccurrence(id, '2026-08-31');
    await deleteRecurring(id);
    expect(await db.transactions.count()).toBe(1);
  });
});

describe('dati demo con ricorrenze e verifiche', () => {
  it.each(['2026-10-30', '2026-11-01', '2026-03-31', '2027-01-15'])('sono coerenti il %s', async (date) => {
    await loadDemoData(date);
    const data = await readAllData();
    expect(parseBackup(serializeBackup(buildBackup(data))).ok).toBe(true);
    expect(data.reconciliations.length).toBeGreaterThan(0);
    expect(pendingCount(pendingRecurring(data.recurring, date))).toBe(3);
    expect(data.transactions.every((item) => item.date <= date)).toBe(true);

    const balances = computeBalances(data.accounts, data.transactions, date);
    expect(balances.get('demo-contanti')).toBeGreaterThan(0);
  });

  it('il saldo verificato coincide con quello calcolato a quella data', async () => {
    await loadDemoData(today);
    const data = await readAllData();
    for (const verification of data.reconciliations) {
      const computed = computeBalances(data.accounts, data.transactions, verification.date).get(verification.accountId);
      expect(computed).toBe(verification.realBalanceCents);
    }
  });
});
