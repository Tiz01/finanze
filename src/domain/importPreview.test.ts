import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './categories';
import { applyRules, buildPreview, fallbackCategoryId, previewDrafts, summarizePreview, type PreviewContext, type PreviewRow } from './importPreview';
import type { StatementRow } from './statementMapping';
import { validateTransaction } from './transactions';
import type { ImportRule, Transaction } from './types';

const categories = [...DEFAULT_CATEGORIES];
const accountId = 'conto';

function row(fields: Partial<StatementRow> = {}): StatementRow {
  return { date: '2026-10-05', description: 'POS ROSSI', amountCents: -1000, ...fields };
}

let counter = 0;
function existing(fields: Partial<Transaction> = {}): Transaction {
  counter += 1;
  return {
    id: `t${counter}`,
    date: '2026-10-05',
    amountCents: 1000,
    type: 'uscita',
    accountId,
    categoryId: 'cat-spesa',
    createdAt: '2026-10-05T10:00:00.000Z',
    ...fields,
  };
}

function preview(rows: StatementRow[], fields: Partial<PreviewContext> = {}): PreviewRow[] {
  return buildPreview(rows, { accountId, transactions: [], rules: [], categories, ...fields });
}

/** Il risultato di aver già importato queste righe. */
function imported(rows: StatementRow[]): Transaction[] {
  return previewDrafts(preview(rows), accountId).map((draft) => existing(draft));
}

describe('duplicati', () => {
  it('una riga mai vista è nuova e si importa', () => {
    const [result] = preview([row()]);
    expect(result?.status).toBe('nuovo');
    expect(result?.include).toBe(true);
  });

  it('reimportando lo stesso file non c’è niente di nuovo', () => {
    const rows = [row(), row({ date: '2026-10-06', description: 'BONIFICO', amountCents: 5000 })];
    const result = preview(rows, { transactions: imported(rows) });
    expect(result.map(({ include, status }) => ({ include, status }))).toEqual([
      { include: false, status: 'gia-importato' },
      { include: false, status: 'gia-importato' },
    ]);
  });

  it('due movimenti identici nello stesso file sono due movimenti', () => {
    const rows = [row(), row()];
    const result = preview(rows);
    expect(result.every((item) => item.status === 'nuovo')).toBe(true);
    expect(new Set(result.map((item) => item.importId)).size).toBe(2);
  });

  it('e reimportando il file risultano già presenti entrambi', () => {
    const rows = [row(), row()];
    expect(preview(rows, { transactions: imported(rows) }).map((item) => item.status)).toEqual(['gia-importato', 'gia-importato']);
  });

  it('con due estratti sovrapposti importa solo le righe che mancano', () => {
    const settembre = [row({ date: '2026-09-28', amountCents: -300 }), row({ date: '2026-10-02', amountCents: -400 })];
    const ottobre = [row({ date: '2026-10-02', amountCents: -400 }), row({ date: '2026-10-20', amountCents: -500 })];
    const result = preview(ottobre, { transactions: imported(settembre) });
    expect(result.map((item) => [item.date, item.status])).toEqual([
      ['2026-10-20', 'nuovo'],
      ['2026-10-02', 'gia-importato'],
    ]);
  });

  it('cambiare categoria dopo l’import non fa perdere il riconoscimento', () => {
    const rows = [row()];
    const [saved] = imported(rows);
    if (!saved) throw new Error('Manca il movimento');
    expect(preview(rows, { transactions: [{ ...saved, categoryId: 'cat-viaggi' }] })[0]?.status).toBe('gia-importato');
  });

  it('non confonde maiuscole e spazi con una descrizione diversa', () => {
    const [saved] = imported([row({ description: 'POS  Rossi' })]);
    if (!saved) throw new Error('Manca il movimento');
    expect(preview([row({ description: 'pos rossi' })], { transactions: [saved] })[0]?.status).toBe('gia-importato');
  });

  it('lo stesso file su un altro conto è nuovo', () => {
    const rows = [row()];
    const other = previewDrafts(preview(rows), 'altro').map((draft) => existing(draft));
    expect(preview(rows, { transactions: other })[0]?.status).toBe('nuovo');
  });

  it('un movimento inserito a mano fa sospettare un doppione anche con la data diversa', () => {
    const manual = existing({ date: '2026-10-03', note: 'Spesa' });
    const [result] = preview([row()], { transactions: [manual] });
    expect(result?.status).toBe('forse-presente');
    expect(result?.match).toBe(manual);
    expect(result?.include).toBe(false);
  });

  it('oltre tre giorni o con un altro importo non è un doppione', () => {
    expect(preview([row()], { transactions: [existing({ date: '2026-10-01' })] })[0]?.status).toBe('nuovo');
    expect(preview([row()], { transactions: [existing({ amountCents: 1001 })] })[0]?.status).toBe('nuovo');
  });

  it('un’entrata non è il doppione di una spesa dello stesso importo', () => {
    const income = existing({ type: 'entrata', categoryId: 'cat-stipendio' });
    expect(preview([row()], { transactions: [income] })[0]?.status).toBe('nuovo');
  });

  it('ogni movimento vale per una riga sola', () => {
    const result = preview([row(), row({ description: 'POS BIANCHI' })], { transactions: [existing()] });
    expect(result.map((item) => item.status).sort()).toEqual(['forse-presente', 'nuovo']);
  });

  it('abbina prima la riga con la data più vicina', () => {
    const manual = existing({ date: '2026-10-06' });
    const result = preview([row({ date: '2026-10-04', description: 'A' }), row({ date: '2026-10-06', description: 'B' })], { transactions: [manual] });
    expect(result.find((item) => item.description === 'B')?.status).toBe('forse-presente');
    expect(result.find((item) => item.description === 'A')?.status).toBe('nuovo');
  });

  it('un movimento già riconosciuto non fa sospettare altre righe', () => {
    const rows = [row()];
    const result = preview([...rows, row({ description: 'ALTRO' })], { transactions: imported(rows) });
    expect(result.find((item) => item.description === 'ALTRO')?.status).toBe('nuovo');
  });

  it('riconosce un trasferimento registrato dall’altro conto, nei due sensi', () => {
    const incoming = existing({ type: 'trasferimento', accountId: 'altro', toAccountId: accountId, categoryId: undefined });
    expect(preview([row({ amountCents: 1000 })], { transactions: [incoming] })[0]?.status).toBe('forse-presente');
    expect(preview([row({ amountCents: -1000 })], { transactions: [incoming] })[0]?.status).toBe('nuovo');
    const outgoing = existing({ type: 'trasferimento', toAccountId: 'altro', categoryId: undefined });
    expect(preview([row()], { transactions: [outgoing] })[0]?.status).toBe('forse-presente');
  });

  it('non guarda i movimenti degli altri conti né le rettifiche', () => {
    const others = [existing({ accountId: 'altro' }), existing({ type: 'rettifica', amountCents: -1000, categoryId: 'cat-non-tracciato' })];
    expect(preview([row()], { transactions: others })[0]?.status).toBe('nuovo');
  });
});

describe('categorie', () => {
  const rules: ImportRule[] = [
    { id: 'r1', contains: 'rossi', categoryId: 'cat-spesa' },
    { id: 'r2', contains: 'stipendio', categoryId: 'cat-stipendio' },
  ];

  it('applica le regole', () => {
    const [result] = preview([row()], { rules });
    expect(result?.categoryId).toBe('cat-spesa');
    expect(result?.fromRule).toBe(true);
  });

  it('il segno decide il tipo', () => {
    const result = preview([row({ description: 'STIPENDIO', amountCents: 140000, date: '2026-10-06' }), row()], { rules });
    expect(result[0]?.type).toBe('entrata');
    expect(result[0]?.categoryId).toBe('cat-stipendio');
    expect(result[1]?.type).toBe('uscita');
  });

  it('senza regola usa la categoria generica e lo segnala', () => {
    const [spesa] = preview([row({ description: 'BOH' })], { rules });
    expect(spesa?.categoryId).toBe('cat-altro');
    expect(spesa?.fromRule).toBe(false);
    expect(preview([row({ description: 'BOH', amountCents: 500 })], { rules })[0]?.categoryId).toBe('cat-straordinarie');
  });

  it('se la categoria generica è archiviata ne usa un’altra attiva', () => {
    const archived = categories.map((category) => ({ ...category, archived: category.id === 'cat-altro' }));
    const chosen = fallbackCategoryId(archived, 'uscita');
    expect(chosen).toBeDefined();
    expect(chosen).not.toBe('cat-altro');
    expect(fallbackCategoryId([], 'uscita')).toBeUndefined();
  });

  it('una nuova regola aggiorna le righe, non quelle cambiate a mano', () => {
    const rows = preview([row({ description: 'BIANCHI' }), row({ description: 'BIANCHI BAR', date: '2026-10-04' })]);
    const first = rows[0];
    if (!first) throw new Error('Manca la riga');
    rows[0] = { ...first, categoryId: 'cat-viaggi', edited: true };
    const updated = applyRules(rows, [{ id: 'r', contains: 'bianchi', categoryId: 'cat-tecnologia' }], categories);
    expect(updated[0]?.categoryId).toBe('cat-viaggi');
    expect(updated[1]?.categoryId).toBe('cat-tecnologia');
    expect(updated[1]?.fromRule).toBe(true);
  });
});

describe('previewDrafts', () => {
  it('trasforma le righe in movimenti validi, con importo positivo', () => {
    const drafts = previewDrafts(preview([row(), row({ description: 'STIPENDIO', amountCents: 140000, date: '2026-10-06' })]), accountId);
    expect(drafts).toHaveLength(2);
    for (const draft of drafts) {
      expect(validateTransaction(draft)).toBeNull();
      expect(draft.amountCents).toBeGreaterThan(0);
      expect(draft.importId).toBeTruthy();
      expect(draft.accountId).toBe(accountId);
    }
    expect(drafts[0]?.type).toBe('entrata');
    expect(drafts[1]?.type).toBe('uscita');
    expect(drafts[1]?.note).toBe('POS ROSSI');
  });

  it('esclude le righe non selezionate', () => {
    const [first] = preview([row()]);
    if (!first) throw new Error('Manca la riga');
    expect(previewDrafts([{ ...first, include: false }], accountId)).toEqual([]);
  });

  it('un’uscita diventata trasferimento parte da questo conto', () => {
    const [first] = preview([row()]);
    if (!first) throw new Error('Manca la riga');
    const [draft] = previewDrafts([{ ...first, type: 'trasferimento', categoryId: undefined, otherAccountId: 'deposito' }], accountId);
    expect(draft).toMatchObject({ type: 'trasferimento', accountId, toAccountId: 'deposito', amountCents: 1000 });
    expect(draft && validateTransaction(draft)).toBeNull();
  });

  it('un’entrata diventata trasferimento arriva su questo conto', () => {
    const [first] = preview([row({ amountCents: 1000 })]);
    if (!first) throw new Error('Manca la riga');
    const [draft] = previewDrafts([{ ...first, type: 'trasferimento', categoryId: undefined, otherAccountId: 'deposito' }], accountId);
    expect(draft).toMatchObject({ type: 'trasferimento', accountId: 'deposito', toAccountId: accountId, amountCents: 1000 });
    expect(draft && validateTransaction(draft)).toBeNull();
  });

  it('un trasferimento senza l’altro conto non passa la validazione', () => {
    const [first] = preview([row()]);
    if (!first) throw new Error('Manca la riga');
    const [draft] = previewDrafts([{ ...first, type: 'trasferimento', categoryId: undefined }], accountId);
    expect(draft && validateTransaction(draft)).not.toBeNull();
  });
});

describe('summarizePreview', () => {
  it('conta solo le righe selezionate, tenendo a parte i trasferimenti', () => {
    const rows = preview([
      row({ date: '2026-10-01', amountCents: -1000, description: 'A' }),
      row({ date: '2026-10-02', amountCents: -500, description: 'B' }),
      row({ date: '2026-10-03', amountCents: 2000, description: 'C' }),
      row({ date: '2026-10-04', amountCents: -700, description: 'D' }),
    ]);
    const adjusted = rows.map((item) =>
      item.description === 'B'
        ? { ...item, include: false }
        : item.description === 'D'
          ? { ...item, type: 'trasferimento' as const, categoryId: undefined, otherAccountId: 'x' }
          : item,
    );
    expect(summarizePreview(adjusted)).toEqual({ count: 3, incomeCents: 2000, expenseCents: 1000, transfers: 1 });
  });
});

describe('ordine', () => {
  it('mostra prima i più recenti, tenendo l’ordine del file a parità di giorno', () => {
    const result = preview([row({ date: '2026-10-01', description: 'A' }), row({ date: '2026-10-03', description: 'B' }), row({ date: '2026-10-03', description: 'C' })]);
    expect(result.map((item) => item.description)).toEqual(['B', 'C', 'A']);
  });
});
