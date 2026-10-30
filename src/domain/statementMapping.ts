import { addDays, isValidIsoDate } from './dates';
import { MAX_AMOUNT_CENTS } from './money';
import type { AmountMapping, DateOrder, ImportMapping, ImportProfile, IsoDate } from './types';

const SEARCH_ROWS = 60;
const SAMPLE_ROWS = 200;
const FIRST_EXCEL_SERIAL = 20_000;
const LAST_EXCEL_SERIAL = 80_000;

/** Minuscolo, senza accenti e spazi doppi: per confrontare testi scritti in modi diversi. */
export function plainText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();
}

const MONTHS: Record<string, number> = {
  gen: 1, jan: 1, feb: 2, mar: 3, apr: 4, mag: 5, may: 5, giu: 6, jun: 6,
  lug: 7, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, ott: 10, oct: 10, nov: 11, dic: 12, dec: 12,
};

function isoDate(year: string, month: number | string, day: number | string): IsoDate | null {
  const fullYear = year.length === 2 ? `20${year}` : year;
  const date = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(date) ? date : null;
}

const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\D|$)/;

/** Le date di un estratto conto: gg/mm/aaaa, aaaa-mm-gg anche con l'ora, 30 ott 2026, oppure un numero di serie di Excel. */
export function parseStatementDate(text: string, order: DateOrder = 'gma'): IsoDate | null {
  const value = text.trim();

  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/.exec(value);
  if (match) return isoDate(match[1] ?? '', match[2] ?? '', match[3] ?? '');

  match = NUMERIC_DATE.exec(value);
  if (match) {
    const [day, month] = order === 'gma' ? [match[1], match[2]] : [match[2], match[1]];
    return isoDate(match[3] ?? '', month ?? '', day ?? '');
  }

  match = /^(\d{1,2})[\s-]+(\p{L}{3})\p{L}*\.?[\s-]+(\d{4}|\d{2})(?:\D|$)/u.exec(value);
  if (match) {
    const month = MONTHS[plainText(match[2] ?? '')];
    return month ? isoDate(match[3] ?? '', month, match[1] ?? '') : null;
  }

  match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match) return isoDate(match[1] ?? '', match[2] ?? '', match[3] ?? '');

  if (/^\d{5}$/.test(value)) {
    const serial = Number(value);
    if (serial >= FIRST_EXCEL_SERIAL && serial <= LAST_EXCEL_SERIAL) return addDays('1899-12-30', serial);
  }
  return null;
}

/** Basta una data con un numero oltre il 12 per capire l'ordine; se non ce ne sono vale quello italiano. */
export function detectDateOrder(values: string[]): DateOrder {
  for (const value of values) {
    const match = NUMERIC_DATE.exec(value.trim());
    if (Number(match?.[1]) > 12) return 'gma';
    if (Number(match?.[2]) > 12) return 'mga';
  }
  return 'gma';
}

function splitSign(text: string): { negative: boolean; digits: string } {
  let digits = text.replace(/[\s'€]/g, '').replace(/eur/gi, '');
  let negative = false;
  if (/^\(.*\)$/.test(digits)) {
    negative = true;
    digits = digits.slice(1, -1);
  }
  if (/^[-−–+]/.test(digits)) {
    negative = digits[0] !== '+';
    digits = digits.slice(1);
  } else if (/[-−–+]$/.test(digits)) {
    negative = digits.at(-1) !== '+';
    digits = digits.slice(0, -1);
  }
  return { negative, digits };
}

export type DecimalSeparator = ',' | '.';

/** Guarda tutta la colonna, perché da solo 1.234 non dice niente: vince la virgola, che è il formato italiano. */
export function detectDecimal(values: string[]): DecimalSeparator {
  let commas = 0;
  let dots = 0;
  for (const value of values) {
    const { digits } = splitSign(value);
    const lastComma = digits.lastIndexOf(',');
    const lastDot = digits.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) commas += 1;
      else dots += 1;
    } else if (lastComma >= 0) {
      if (!/^\d{1,3}(,\d{3})+$/.test(digits)) commas += 1;
    } else if (lastDot >= 0) {
      if (!/^\d{1,3}(\.\d{3})+$/.test(digits)) dots += 1;
    }
  }
  return dots > commas ? '.' : ',';
}

const AMOUNT_FORMATS: Record<DecimalSeparator, { pattern: RegExp; thousands: string }> = {
  ',': { pattern: /^(\d{1,3}(?:\.\d{3})+|\d*)(?:,(\d{1,2}))?$/, thousands: '.' },
  '.': { pattern: /^(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{1,2}))?$/, thousands: ',' },
};

/** I centesimi con il loro segno, oppure null se il testo non è un importo. Solo calcoli su interi. */
export function parseStatementAmount(text: string, decimal: DecimalSeparator = ','): number | null {
  const { negative, digits } = splitSign(text);
  const { pattern, thousands } = AMOUNT_FORMATS[decimal];
  const match = pattern.exec(digits);
  if (!match || digits === '') return null;
  const units = (match[1] ?? '').replaceAll(thousands, '');
  const decimals = match[2] ?? '';
  if (units === '' && decimals === '') return null;
  const cents = Number(units || '0') * 100 + Number(decimals.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return negative && cents !== 0 ? -cents : cents;
}

const HEADER_WORD =
  /\b(data|date|fecha|valuta|descrizione|description|causale|dettagli|concetto|concepto|movimento|operazione|importo|importe|amount|entrate|uscite|dare|avere|accrediti|addebiti|saldo|euro)\b/;

function isDateCell(cell: string): boolean {
  return parseStatementDate(cell, 'gma') !== null || parseStatementDate(cell, 'mga') !== null;
}

function isAmountCell(cell: string): boolean {
  return /\d/.test(cell) && parseStatementAmount(cell, detectDecimal([cell])) !== null;
}

/** La riga con le intestazioni: spesso prima ci sono intestatario, IBAN e periodo. Null se il file parte dai movimenti. */
export function findHeaderRow(rows: string[][]): number | null {
  let best: number | null = null;
  let bestScore = 1;
  rows.slice(0, SEARCH_ROWS).forEach((row, index) => {
    let score = 0;
    for (const cell of row) {
      if (HEADER_WORD.test(plainText(cell))) score += 1;
      if (isDateCell(cell) || isAmountCell(cell)) score -= 1;
    }
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  if (best !== null) return best;

  const firstData = rows.slice(0, SEARCH_ROWS).findIndex((row) => row.some(isDateCell) && row.some(isAmountCell));
  return firstData > 0 ? firstData - 1 : null;
}

export function dataRows(rows: string[][], headerRow: number | null): string[][] {
  return headerRow === null ? rows : rows.slice(headerRow + 1);
}

interface ColumnSample {
  index: number;
  header: string;
  values: string[];
  isDate: boolean;
  isAmount: boolean;
  letterShare: number;
  averageLength: number;
}

// Non tutti: anche in un estratto breve può esserci una riga finale di saldo o di totale.
const ENOUGH = 0.6;

function share(values: string[], test: (value: string) => boolean): number {
  return values.length === 0 ? 0 : values.filter(test).length / values.length;
}

function sampleColumns(rows: string[][], headerRow: number | null): ColumnSample[] {
  const headers = headerRow === null ? [] : (rows[headerRow] ?? []).map(plainText);
  const sample = dataRows(rows, headerRow).slice(0, SAMPLE_ROWS);
  const width = Math.max(headers.length, ...sample.map((row) => row.length), 0);
  return Array.from({ length: width }, (_, index) => {
    const values = sample.map((row) => row[index] ?? '').filter((value) => value !== '');
    const decimal = detectDecimal(values);
    const isDate = share(values, isDateCell) >= ENOUGH;
    return {
      index,
      header: headers[index] ?? '',
      values,
      isDate,
      isAmount: !isDate && share(values, (value) => /\d/.test(value) && parseStatementAmount(value, decimal) !== null) >= ENOUGH,
      letterShare: share(values, (value) => /\p{L}{2}/u.test(value)),
      averageLength: values.reduce((total, value) => total + value.length, 0) / Math.max(1, values.length),
    };
  });
}

function best<T>(items: T[], score: (item: T) => number): T | undefined {
  let winner: T | undefined;
  let winnerScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > winnerScore) {
      winner = item;
      winnerScore = value;
    }
  }
  return winner;
}

const AMOUNT_HEADER = /\b(importo|importi|amount|euro|eur|importe|valore)\b|€/;
const NOT_AMOUNT_HEADER = /\b(saldo|balance|disponibile|conto|iban|carta|numero|cro|fee|commissione|commissioni|id)\b/;
const INCOME_HEADER = /\b(entrate|entrata|accrediti|accredito|avere|credito|credit|haber)\b/;
const EXPENSE_HEADER = /\b(uscite|uscita|addebiti|addebito|dare|debito|debit|debe)\b/;
const DIRECTION_VALUE = /^(dare|avere|d|a|c|cr|db|\+|-|entrata|uscita|accredito|addebito|credit|debit|credito|debito)$/i;
const INCOME_VALUE = /^(avere|a|c|cr|\+|entrata|accredito|credit|credito)$/i;

function guessAmount(columns: ColumnSample[]): AmountMapping {
  const candidates = columns.filter((column) => !column.isDate && !NOT_AMOUNT_HEADER.test(column.header));
  const usable = (column: ColumnSample) => column.isAmount || column.values.length === 0;

  const income = candidates.find(({ header, ...rest }) => INCOME_HEADER.test(header) && !EXPENSE_HEADER.test(header) && usable({ header, ...rest }));
  const expense = candidates.find(({ header, ...rest }) => EXPENSE_HEADER.test(header) && !INCOME_HEADER.test(header) && usable({ header, ...rest }));
  if (income && expense) return { mode: 'due-colonne', incomeColumn: income.index, expenseColumn: expense.index };

  const amount =
    candidates.find((column) => column.isAmount && AMOUNT_HEADER.test(column.header)) ??
    candidates.find((column) => column.isAmount && column.values.some((value) => /[.,-]/.test(value)));
  if (!amount) return { mode: 'segno', column: null, invert: false };

  const decimal = detectDecimal(amount.values);
  if (amount.values.some((value) => (parseStatementAmount(value, decimal) ?? 0) < 0)) {
    return { mode: 'segno', column: amount.index, invert: false };
  }

  // Tutti positivi: o c'è una colonna che dice la direzione, o sono spese, come negli estratti delle carte.
  const direction = columns.find((column) => {
    const distinct = new Set(column.values.map((value) => value.toLowerCase()));
    return column.index !== amount.index && distinct.size >= 2 && distinct.size <= 4 && [...distinct].every((value) => DIRECTION_VALUE.test(value));
  });
  if (!direction) return { mode: 'segno', column: amount.index, invert: true };
  const values = [...new Set(direction.values)];
  return {
    mode: 'tipo',
    column: amount.index,
    typeColumn: direction.index,
    incomeValue: values.find((value) => INCOME_VALUE.test(value)) ?? values[0] ?? '',
  };
}

const DATE_HEADER = /\b(data|date|fecha|giorno)\b/;
const DATE_PREFERRED = /operazione|contabil|booking|completed/;
const DATE_UNWANTED = /valuta|value|valor/;
const DESCRIPTION_HEADER =
  /\b(descrizione|description|causale|dettagli|dettaglio|details|operazione|movimento|concetto|concepto|beneficiario|partner|esercente|merchant|reference|riferimento|memo|note|osservazioni)\b/;

/** Una prima proposta da mostrare a chi importa: la conferma, o la corregge, nella mappatura. */
export function guessMapping(rows: string[][], headerRow: number | null): ImportMapping {
  const columns = sampleColumns(rows, headerRow);

  const date = best(
    columns.filter((column) => column.isDate),
    ({ header }) => (DATE_HEADER.test(header) ? 2 : 0) + (DATE_PREFERRED.test(header) ? 2 : 0) - (DATE_UNWANTED.test(header) ? 3 : 0),
  );
  const amount = guessAmount(columns);
  const taken = new Set(
    amount.mode === 'due-colonne' ? [amount.incomeColumn, amount.expenseColumn] : [amount.column, amount.mode === 'tipo' ? amount.typeColumn : null],
  );
  const description = best(
    columns.filter((column) => !column.isDate && !taken.has(column.index) && column.letterShare >= 0.5),
    ({ averageLength, header }) => (DESCRIPTION_HEADER.test(header) ? 1000 : 0) + averageLength,
  );

  return {
    headerRow,
    dateColumn: date?.index ?? null,
    dateOrder: detectDateOrder(date?.values ?? []),
    descriptionColumn: description?.index ?? null,
    detailsColumn: null,
    amount,
  };
}

/** Cosa manca perché la mappatura si possa usare. */
export function mappingProblem(mapping: ImportMapping): string | null {
  if (mapping.dateColumn === null) return 'Scegli la colonna della data';
  if (mapping.descriptionColumn === null) return 'Scegli la colonna della descrizione';
  const { amount } = mapping;
  switch (amount.mode) {
    case 'segno':
      return amount.column === null ? 'Scegli la colonna dell’importo' : null;
    case 'due-colonne':
      if (amount.incomeColumn === null || amount.expenseColumn === null) return 'Scegli le colonne di entrate e uscite';
      return amount.incomeColumn === amount.expenseColumn ? 'Entrate e uscite devono essere colonne diverse' : null;
    case 'tipo':
      if (amount.column === null) return 'Scegli la colonna dell’importo';
      if (amount.typeColumn === null) return 'Scegli la colonna con il tipo';
      return amount.incomeValue === '' ? 'Scegli il valore che indica un’entrata' : null;
  }
}

export interface StatementRow {
  date: IsoDate;
  description: string;
  /** Con il segno: negativo se i soldi escono dal conto. */
  amountCents: number;
}

export interface SkippedRow {
  text: string;
  reason: string;
}

const BALANCE_ROW = /^saldo( (iniziale|finale|contabile|disponibile|liquido|precedente|al|alla|del)\b|$)/;

function amountReader(rows: string[][], amount: AmountMapping) {
  const reader = (column: number | null) => {
    const decimal = detectDecimal(rows.map((row) => (column === null ? '' : (row[column] ?? ''))).filter(Boolean));
    return (row: string[]) => {
      const cell = column === null ? '' : (row[column] ?? '');
      return { blank: cell === '', cents: cell === '' ? null : parseStatementAmount(cell, decimal) };
    };
  };

  switch (amount.mode) {
    case 'segno': {
      const read = reader(amount.column);
      return (row: string[]) => {
        const { blank, cents } = read(row);
        return { blank, cents: cents !== null && amount.invert ? -cents : cents };
      };
    }
    case 'due-colonne': {
      const income = reader(amount.incomeColumn);
      const expense = reader(amount.expenseColumn);
      return (row: string[]) => {
        const received = income(row);
        const paid = expense(row);
        if (received.blank && paid.blank) return { blank: true, cents: null };
        if ((!received.blank && received.cents === null) || (!paid.blank && paid.cents === null)) return { blank: false, cents: null };
        return { blank: false, cents: Math.abs(received.cents ?? 0) - Math.abs(paid.cents ?? 0) };
      };
    }
    case 'tipo': {
      const read = reader(amount.column);
      const incomeValue = amount.incomeValue.toLowerCase();
      return (row: string[]) => {
        const { blank, cents } = read(row);
        const type = amount.typeColumn === null ? '' : (row[amount.typeColumn] ?? '');
        if (cents === null) return { blank, cents };
        return { blank, cents: type.toLowerCase() === incomeValue ? Math.abs(cents) : -Math.abs(cents) };
      };
    }
  }
}

/** Trasforma le righe del file in movimenti, tenendo da parte con il motivo quelle che non lo sono. */
export function extractRows(rows: string[][], mapping: ImportMapping): { rows: StatementRow[]; skipped: SkippedRow[] } {
  const { dateColumn, dateOrder, descriptionColumn, detailsColumn } = mapping;
  const body = dataRows(rows, mapping.headerRow);
  const readAmount = amountReader(body, mapping.amount);
  const statement: StatementRow[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of body) {
    const text = row.filter(Boolean).join(' · ');
    const dateCell = dateColumn === null ? '' : (row[dateColumn] ?? '');
    const description = [descriptionColumn, detailsColumn]
      .map((column) => (column === null ? '' : (row[column] ?? '')))
      .filter(Boolean)
      .join(' · ');
    const { blank, cents } = readAmount(row);

    // Né data né importo: un titolo o una riga di chiusura, non un movimento perso.
    if (dateCell === '' && blank) continue;

    if (BALANCE_ROW.test(plainText(description)) || BALANCE_ROW.test(plainText(dateCell))) {
      skipped.push({ text, reason: 'È una riga di saldo, non un movimento' });
    } else if (dateCell === '') {
      skipped.push({ text, reason: 'Manca la data' });
    } else if (blank) {
      skipped.push({ text, reason: 'Manca l’importo' });
    } else {
      const date = parseStatementDate(dateCell, dateOrder);
      if (date === null) skipped.push({ text, reason: 'Data non leggibile' });
      else if (cents === null) skipped.push({ text, reason: 'Importo non leggibile' });
      else if (cents === 0) skipped.push({ text, reason: 'Importo pari a zero' });
      else statement.push({ date, description, amountCents: cents });
    }
  }
  return { rows: statement, skipped };
}

export function signatureOf(headers: string[]): string {
  return headers.map(plainText).join('|').replace(/\|+$/, '');
}

/** La banca di questo file, se ne è già stata salvata la mappatura. Le righe prima delle intestazioni possono cambiare. */
export function findProfile(rows: string[][], profiles: ImportProfile[]): { profile: ImportProfile; headerRow: number } | null {
  const bySignature = new Map(profiles.filter((profile) => profile.signature).map((profile) => [profile.signature, profile]));
  if (bySignature.size === 0) return null;
  for (const [headerRow, row] of rows.slice(0, SEARCH_ROWS).entries()) {
    const profile = bySignature.get(signatureOf(row));
    if (profile) return { profile, headerRow };
  }
  return null;
}

/** Non crede a un file di backup: una mappatura rovinata non deve bloccare l'import. */
export function mappingShapeProblem(mapping: unknown): string | null {
  const isColumn = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 0);
  const record = mapping as Partial<ImportMapping> | null | undefined;
  if (typeof record !== 'object' || record === null) return 'la mappatura non è valida';
  const { amount } = record;
  if (!isColumn(record.headerRow) || !isColumn(record.dateColumn) || !isColumn(record.descriptionColumn) || !isColumn(record.detailsColumn)) {
    return 'le colonne non sono valide';
  }
  if (record.dateOrder !== 'gma' && record.dateOrder !== 'mga') return 'l’ordine delle date non è valido';
  if (typeof amount !== 'object' || amount === null) return 'la colonna dell’importo non è valida';
  const validAmount =
    (amount.mode === 'segno' && isColumn(amount.column) && typeof amount.invert === 'boolean') ||
    (amount.mode === 'due-colonne' && isColumn(amount.incomeColumn) && isColumn(amount.expenseColumn)) ||
    (amount.mode === 'tipo' && isColumn(amount.column) && isColumn(amount.typeColumn) && typeof amount.incomeValue === 'string');
  return validAmount ? null : 'la colonna dell’importo non è valida';
}

export interface ColumnChoice {
  value: string;
  label: string;
}

/** Le colonne da proporre nella mappatura: l'intestazione, se c'è, con un esempio preso dal file. */
export function describeColumns(rows: string[][], headerRow: number | null): ColumnChoice[] {
  const headers = headerRow === null ? [] : (rows[headerRow] ?? []);
  const body = dataRows(rows, headerRow);
  const width = Math.max(headers.length, ...body.slice(0, SAMPLE_ROWS).map((row) => row.length), 0);
  return Array.from({ length: width }, (_, index) => {
    const name = headers[index] || `Colonna ${index + 1}`;
    const example = body.find((row) => row[index])?.[index];
    return { value: String(index), label: example ? `${name} (${example.slice(0, 24)})` : name };
  });
}

/** I valori diversi di una colonna, per scegliere quale indica un'entrata. */
export function distinctValues(rows: string[][], headerRow: number | null, column: number | null): string[] {
  if (column === null) return [];
  return [...new Set(dataRows(rows, headerRow).map((row) => row[column] ?? '').filter(Boolean))].slice(0, 12);
}

export function guessIncomeValue(values: string[]): string {
  return values.find((value) => INCOME_VALUE.test(value)) ?? '';
}
