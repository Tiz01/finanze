import { computeBalances } from '../domain/balances';
import { CATEGORY_IDS } from '../domain/categories';
import { addDays, addMonths, startOfMonth } from '../domain/dates';
import { firstOccurrenceOnOrAfter } from '../domain/recurring';
import { snapshotId } from '../domain/investments';
import type {
  Account,
  Holding,
  HoldingSnapshot,
  IsoDate,
  Recurring,
  Reconciliation,
  Transaction,
  TransactionDraft,
} from '../domain/types';

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
  recurring: Recurring[];
  reconciliations: Reconciliation[];
  holdings: Holding[];
  holdingSnapshots: HoldingSnapshot[];
} {
  const createdAt = (offset: number) => new Date(now.getTime() + offset).toISOString();
  const start = addMonths(startOfMonth(today), -(DEMO_MONTHS - 1));

  const accounts = [
    makeAccount('demo-corrente', 'Conto Demo', 'corrente', 120000, start, true, createdAt(0)),
    makeAccount('demo-contanti', 'Contanti Demo', 'contanti', 8000, start, true, createdAt(1)),
    makeAccount('demo-deposito', 'Deposito Demo', 'deposito', 300000, start, false, createdAt(2)),
    makeAccount('demo-broker', 'Broker Demo', 'investimento', 50000, start, false, createdAt(3)),
    {
      ...makeAccount('demo-remunerato', 'Conto Remunerato Demo', 'remunerato', 200000, start, false, createdAt(7)),
      interest: { ratePercentMicros: 3_000_000, rateKind: 'lordo' as const, taxPercentMicros: 26_000_000, intervalMonths: 1, startDate: start, termMonths: 12 },
    },
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
  const validTransactions = transactions.filter((item) => !item.reimbursesId || ids.has(item.reimbursesId));

  // Una verifica che torna e una che ha richiesto una rettifica.
  const verifiedDate = addDays(today, -5);
  const adjustedDate = addDays(today, -20);
  const adjustment: Transaction = {
    id: 'demo-rettifica',
    date: adjustedDate,
    amountCents: -350,
    type: 'rettifica',
    accountId: 'demo-contanti',
    categoryId: CATEGORY_IDS.nonTracciato,
    createdAt: createdAt(4),
  };
  const allTransactions = [...validTransactions, adjustment];
  const balanceAt = (accountId: string, date: IsoDate) =>
    computeBalances(accounts, allTransactions, date).get(accountId) ?? 0;

  const reconciliations: Reconciliation[] = [
    { id: 'demo-verifica-1', accountId: 'demo-corrente', date: verifiedDate, realBalanceCents: balanceAt('demo-corrente', verifiedDate) },
    {
      id: 'demo-verifica-2',
      accountId: 'demo-contanti',
      date: adjustedDate,
      realBalanceCents: balanceAt('demo-contanti', adjustedDate),
      adjustmentId: adjustment.id,
    },
  ];

  // Due ricorrenze con scadenze da confermare e una ancora da venire.
  const thisMonth = startOfMonth(today);
  const pac = { frequency: 'mensile', anchorDate: `${start.slice(0, 7)}-28` } as const;
  const recurring: Recurring[] = [
    {
      id: 'demo-internet',
      name: 'Internet di casa (demo)',
      frequency: 'mensile',
      anchorDate: thisMonth,
      nextDue: thisMonth,
      active: true,
      template: { type: 'uscita', amountCents: 2490, accountId: 'demo-corrente', categoryId: 'cat-casa' },
    },
    {
      id: 'demo-palestra',
      name: 'Corso di nuoto (demo)',
      frequency: 'mensile',
      anchorDate: addMonths(thisMonth, -1),
      nextDue: addMonths(thisMonth, -1),
      active: true,
      template: { type: 'uscita', amountCents: 3500, accountId: 'demo-corrente', categoryId: 'cat-sport-salute' },
    },
    {
      id: 'demo-pac',
      name: 'Piano di accumulo (demo)',
      ...pac,
      nextDue: firstOccurrenceOnOrAfter(pac, addDays(today, 1)),
      active: true,
      template: { type: 'trasferimento', amountCents: 10000, accountId: 'demo-corrente', toAccountId: 'demo-broker' },
    },
  ];

  // Due strumenti inventati, con un aggiornamento al mese.
  const holdings: Holding[] = [
    { id: 'demo-etf-mondo', accountId: 'demo-broker', instrument: 'ETF Mondo (demo)', isin: '', createdAt: createdAt(5) },
    { id: 'demo-etf-bond', accountId: 'demo-broker', instrument: 'ETF Obbligazioni 2028 (demo)', isin: '', createdAt: createdAt(6) },
  ];
  const history = (holdingId: string, rows: readonly (readonly [number, number, number])[]): HoldingSnapshot[] =>
    rows.flatMap(([quantityMicros, avgPriceMicros, priceMicros], month) => {
      const date = addMonths(start, month);
      return date <= today
        ? [{ id: snapshotId(holdingId, date), holdingId, date, quantityMicros, avgPriceMicros, priceMicros }]
        : [];
    });
  const holdingSnapshots = [
    ...history('demo-etf-mondo', [
      [10_000_000, 100_000_000, 104_000_000],
      [11_000_000, 100_360_000, 106_200_000],
      [12_000_000, 100_750_000, 103_800_000],
      [13_000_000, 101_120_000, 108_400_000],
    ]),
    ...history('demo-etf-bond', [
      [20_000_000, 10_000_000, 10_050_000],
      [20_000_000, 10_000_000, 10_120_000],
      [20_000_000, 10_000_000, 10_180_000],
      [20_000_000, 10_000_000, 10_210_000],
    ]),
  ];

  return { accounts, transactions: allTransactions, recurring, reconciliations, holdings, holdingSnapshots };
}
