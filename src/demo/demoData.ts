import { addMonths, startOfMonth } from '../domain/dates';
import { CATEGORY_IDS } from '../domain/categories';
import type { Account, IsoDate, Transaction, TransactionDraft } from '../domain/types';

// Dati inventati, caricati solo dal pulsante "Carica dati demo": non corrispondono a nessuna persona.

const DEMO_MONTHS = 4;

function makeAccount(
  id: string,
  name: string,
  type: Account['type'],
  initialBalanceCents: number,
  initialBalanceDate: IsoDate,
  contaComeLiquidita: boolean,
  createdAt: string,
): Account {
  return {
    id,
    name,
    type,
    currency: 'EUR',
    initialBalanceCents,
    initialBalanceDate,
    archived: false,
    contaComeLiquidita,
    createdAt,
  };
}

export function buildDemoData(today: IsoDate, now: Date = new Date()): {
  accounts: Account[];
  transactions: Transaction[];
} {
  const createdAt = (offset: number) => new Date(now.getTime() + offset).toISOString();
  const start = addMonths(startOfMonth(today), -(DEMO_MONTHS - 1));

  const accounts = [
    makeAccount('demo-corrente', 'Conto Demo', 'corrente', 120000, start, true, createdAt(0)),
    makeAccount('demo-contanti', 'Contanti Demo', 'contanti', 8000, start, true, createdAt(1)),
    makeAccount('demo-deposito', 'Deposito Demo', 'deposito', 300000, start, false, createdAt(2)),
    makeAccount('demo-broker', 'Broker Demo', 'investimento', 50000, start, false, createdAt(3)),
  ];

  const drafts: (TransactionDraft & { id?: string })[] = [];
  const add = (monthStart: IsoDate, day: number, draft: Omit<TransactionDraft, 'date'> & { id?: string }) => {
    drafts.push({ ...draft, date: `${monthStart.slice(0, 7)}-${String(day).padStart(2, '0')}` });
  };

  for (let month = 0; month < DEMO_MONTHS; month += 1) {
    const monthStart = addMonths(start, month);
    const corrente = 'demo-corrente';

    add(monthStart, 5, { type: 'entrata', amountCents: 140000, accountId: corrente, categoryId: CATEGORY_IDS.stipendio, note: 'Stipendio (demo)' });
    add(monthStart, 6, { type: 'uscita', amountCents: 45000, accountId: corrente, categoryId: 'cat-casa', note: 'Affitto (demo)' });
    add(monthStart, 7, { type: 'trasferimento', amountCents: 10000, accountId: corrente, toAccountId: 'demo-broker', note: 'Piano di accumulo (demo)' });
    add(monthStart, 8, { type: 'trasferimento', amountCents: 5000, accountId: corrente, toAccountId: 'demo-deposito', note: 'Risparmio (demo)' });
    add(monthStart, 10, { type: 'uscita', amountCents: 1299, accountId: corrente, categoryId: 'cat-abbonamenti', note: 'Musica in streaming (demo)' });
    add(monthStart, 3, { type: 'uscita', amountCents: 4520, accountId: corrente, categoryId: 'cat-spesa', note: 'Supermercato (demo)' });
    add(monthStart, 12, { type: 'uscita', amountCents: 5180, accountId: corrente, categoryId: 'cat-spesa', note: 'Supermercato (demo)' });
    add(monthStart, 19, { type: 'uscita', amountCents: 3890, accountId: corrente, categoryId: 'cat-spesa', note: 'Supermercato (demo)' });
    add(monthStart, 26, { type: 'uscita', amountCents: 4210, accountId: corrente, categoryId: 'cat-spesa', note: 'Supermercato (demo)' });
    add(monthStart, 9, { type: 'uscita', amountCents: 250, accountId: 'demo-contanti', categoryId: 'cat-ristoranti', note: 'Caffè (demo)' });
    add(monthStart, 15, { type: 'uscita', amountCents: 3000, accountId: corrente, categoryId: 'cat-trasporti', note: 'Abbonamento treno (demo)' });
    add(monthStart, 21, { type: 'uscita', amountCents: 2400, accountId: corrente, categoryId: 'cat-sport-salute', note: 'Palestra (demo)' });

    if (month === 1) {
      add(monthStart, 14, { id: 'demo-cena', type: 'uscita', amountCents: 8000, accountId: corrente, categoryId: 'cat-ristoranti', note: 'Cena con amici (demo)', tags: ['demo'] });
      add(monthStart, 16, { type: 'entrata', amountCents: 4000, accountId: corrente, categoryId: CATEGORY_IDS.rimborsi, reimbursesId: 'demo-cena', note: 'Mi ridanno metà cena (demo)' });
      add(monthStart, 18, { type: 'entrata', amountCents: 5000, accountId: corrente, categoryId: CATEGORY_IDS.regaliRicevuti, note: 'Regalo di compleanno (demo)' });
    }
    if (month === 2) {
      add(monthStart, 11, { type: 'uscita', amountCents: 18900, accountId: corrente, categoryId: 'cat-viaggi', note: 'Weekend al mare (demo)', tags: ['demo', 'viaggio'] });
    }
  }

  const transactions = drafts
    .filter((draft) => draft.date <= today)
    .map((draft, index): Transaction => {
      const { id, ...fields } = draft;
      const createdAtRow = new Date(now.getTime() - (drafts.length - index) * 1000).toISOString();
      return { ...fields, id: id ?? `demo-${index}`, createdAt: createdAtRow };
    });

  // Il rimborso resta valido solo se anche la spesa rientra nel periodo.
  const ids = new Set(transactions.map((transaction) => transaction.id));
  return {
    accounts,
    transactions: transactions.filter((item) => !item.reimbursesId || ids.has(item.reimbursesId)),
  };
}
