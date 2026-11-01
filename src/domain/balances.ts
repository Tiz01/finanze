import { addDays, isValidIsoDate } from './dates';
import type { Account, IsoDate, Transaction } from './types';

/** Di quanto un movimento cambia i conti che tocca. */
function balanceEffects({ accountId, amountCents, toAccountId, type }: Transaction): [string | undefined, number][] {
  switch (type) {
    case 'entrata':
    case 'rettifica':
      return [[accountId, amountCents]];
    case 'uscita':
      return [[accountId, -amountCents]];
    case 'trasferimento':
      return [
        [accountId, -amountCents],
        [toAccountId, amountCents],
      ];
  }
}

/**
 * I saldi non vengono mai salvati: si ricalcolano da saldo iniziale e movimenti.
 * Conta solo ciò che è avvenuto dalla data del saldo iniziale fino ad `asOf`: i movimenti
 * precedenti sono già compresi nel saldo iniziale e restano utili solo per i report.
 */
export function computeBalances(
  accounts: Account[],
  transactions: Transaction[],
  asOf: IsoDate,
): Map<string, number> {
  const balances = new Map<string, number>();
  const startDates = new Map<string, IsoDate>();
  for (const account of accounts) {
    balances.set(account.id, account.initialBalanceCents);
    startDates.set(account.id, account.initialBalanceDate);
  }

  for (const transaction of transactions) {
    if (transaction.date > asOf) continue;
    for (const [accountId, delta] of balanceEffects(transaction)) {
      if (accountId === undefined) continue;
      const start = startDates.get(accountId);
      if (start === undefined || transaction.date < start) continue;
      balances.set(accountId, (balances.get(accountId) ?? 0) + delta);
    }
  }
  return balances;
}

/**
 * Saldo iniziale e data con cui il saldo di un conto risulta `cents` quel giorno.
 * I movimenti di quello stesso giorno contano nel saldo: vanno tolti, o verrebbero contati due volte.
 */
export function balanceFieldsFor(
  account: Account,
  cents: number,
  transactions: Transaction[],
  date: IsoDate,
): Pick<Account, 'initialBalanceCents' | 'initialBalanceDate'> {
  const sameDay = computeBalances([{ ...account, initialBalanceCents: 0, initialBalanceDate: date }], transactions, date);
  return { initialBalanceCents: cents - (sameDay.get(account.id) ?? 0), initialBalanceDate: date };
}

/** Per poche ore la liquidità di un conto investimento si è scritta in due campi a parte: ora è il saldo del conto. */
export function mergeWrittenCash(account: Account & { cashCents?: unknown; cashDate?: unknown }, transactions: Transaction[]): Account {
  const { cashCents, cashDate, ...rest } = account;
  if (typeof cashCents !== 'number' || !isValidIsoDate(cashDate)) return rest;
  return { ...rest, ...balanceFieldsFor(rest, cashCents, transactions, cashDate) };
}

/** La somma dei conti in uso che contano come liquidità. */
export function liquidityCents(accounts: Account[], balances: Map<string, number>): number {
  let total = 0;
  for (const account of accounts) {
    if (account.contaComeLiquidita && !account.archived) total += balances.get(account.id) ?? 0;
  }
  return total;
}

export interface LiquidityPoint {
  date: IsoDate;
  cents: number;
}

const MAX_SERIES_POINTS = 400;

/**
 * La liquidità giorno per giorno, dalla prima data in cui esiste un saldo.
 * Conta gli stessi conti di `liquidityCents`: un conto entra nella serie alla data del suo saldo iniziale.
 */
export function liquiditySeries(
  accounts: Account[],
  transactions: Transaction[],
  from: IsoDate,
  to: IsoDate,
): LiquidityPoint[] {
  const liquid = accounts.filter((account) => account.contaComeLiquidita && !account.archived);
  if (liquid.length === 0) return [];

  const startDates = new Map(liquid.map((account) => [account.id, account.initialBalanceDate]));
  const changes = new Map<IsoDate, number>();
  const change = (date: IsoDate, delta: number) => changes.set(date, (changes.get(date) ?? 0) + delta);

  for (const account of liquid) change(account.initialBalanceDate, account.initialBalanceCents);
  for (const transaction of transactions) {
    for (const [accountId, delta] of balanceEffects(transaction)) {
      if (accountId === undefined) continue;
      const start = startDates.get(accountId);
      if (start !== undefined && transaction.date >= start) change(transaction.date, delta);
    }
  }

  const firstDate = [...startDates.values()].reduce((first, date) => (date < first ? date : first));
  const start = from > firstDate ? from : firstDate;
  if (start > to) return [];

  let running = 0;
  for (const [date, delta] of changes) {
    if (date < start) running += delta;
  }

  const points: LiquidityPoint[] = [];
  for (let date = start; date <= to; date = addDays(date, 1)) {
    running += changes.get(date) ?? 0;
    points.push({ date, cents: running });
  }
  return thinOut(points, MAX_SERIES_POINTS);
}

/** Tiene al più `limit` punti a distanza regolare, sempre compresi il primo e l'ultimo. */
export function thinOut<T>(points: T[], limit: number): T[] {
  if (points.length <= limit) return points;
  const kept: T[] = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    const point = points[Math.round(index * step)];
    if (point !== undefined) kept.push(point);
  }
  return kept;
}

/** Tacche tonde per l'asse dei saldi: passi da 1, 2 o 5 × 10ⁿ che comprendono tutti i valori, mai sotto l'euro. */
export function axisTicks(minCents: number, maxCents: number, count = 4): number[] {
  const rough = Math.max(maxCents - minCents, 300) / (count - 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [power, 2 * power, 5 * power].find((candidate) => candidate >= rough) ?? 10 * power;
  const first = Math.floor(minCents / step) * step;
  const last = Math.max(Math.ceil(maxCents / step) * step, first + step);
  const ticks: number[] = [];
  for (let tick = first; tick <= last; tick += step) ticks.push(tick);
  return ticks;
}
