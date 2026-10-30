const NBSP = ' ';
const MINUS = '−';
const CURRENCY_SYMBOLS: Record<string, string> = { EUR: '€' };

export const MAX_AMOUNT_CENTS = 99_999_999_999;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Niente Intl: con it-IT non separa le migliaia a 4 cifre (1234,56) e passerebbe dai float.
export function formatCentsPlain(cents: number): string {
  const abs = Math.abs(cents);
  const units = String(Math.trunc(abs / 100));
  const decimals = String(abs % 100).padStart(2, '0');
  return `${cents < 0 ? MINUS : ''}${groupThousands(units)},${decimals}`;
}

export function formatCents(cents: number, currency = 'EUR'): string {
  return `${formatCentsPlain(cents)}${NBSP}${CURRENCY_SYMBOLS[currency] ?? currency}`;
}

export function formatSignedCents(cents: number, currency = 'EUR'): string {
  return `${cents > 0 ? '+' : ''}${formatCents(cents, currency)}`;
}

/**
 * Legge un importo scritto a mano o da un file: `1.234,56`, `1234,56`, `12,5`, `1.234`, `12.50`.
 * Restituisce i centesimi, oppure null se il testo non è un importo o ha più di due decimali.
 */
export function parseAmount(text: string): number | null {
  let value = text.replace(/[\s €]/g, '');
  let negative = false;
  if (/^[-−+]/.test(value)) {
    negative = value[0] !== '+';
    value = value.slice(1);
  }
  if (!/^[\d.,]+$/.test(value)) return null;

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let integerPart = value;
  let decimalPart = '';

  if (lastComma >= 0 && lastDot >= 0) {
    const separator = Math.max(lastComma, lastDot);
    integerPart = value.slice(0, separator);
    decimalPart = value.slice(separator + 1);
    const thousands = lastComma > lastDot ? '.' : ',';
    if (integerPart.includes(lastComma > lastDot ? ',' : '.')) return null;
    if (!isGrouped(integerPart, thousands)) return null;
    integerPart = integerPart.split(thousands).join('');
  } else if (lastComma >= 0) {
    if (value.indexOf(',') !== lastComma) return null;
    integerPart = value.slice(0, lastComma);
    decimalPart = value.slice(lastComma + 1);
  } else if (lastDot >= 0) {
    if (isGrouped(value, '.')) {
      integerPart = value.split('.').join('');
    } else {
      if (value.indexOf('.') !== lastDot) return null;
      integerPart = value.slice(0, lastDot);
      decimalPart = value.slice(lastDot + 1);
    }
  }

  if (decimalPart.length > 2 || !/^\d*$/.test(integerPart) || !/^\d*$/.test(decimalPart)) return null;
  if (integerPart === '' && decimalPart === '') return null;

  const cents = Number(integerPart || '0') * 100 + Number(decimalPart.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return negative && cents !== 0 ? -cents : cents;
}

function isGrouped(value: string, separator: string): boolean {
  const parts = value.split(separator);
  if (parts.length < 2) return true;
  const [first, ...rest] = parts;
  return /^\d{1,3}$/.test(first ?? '') && rest.every((part) => /^\d{3}$/.test(part));
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | ',' | 'back';

const MAX_INTEGER_DIGITS = 9;

/** Applica un tasto del tastierino al testo digitato finora. */
export function applyKeypadKey(input: string, key: KeypadKey): string {
  if (key === 'back') return input.slice(0, -1);
  if (key === ',') {
    if (input.includes(',')) return input;
    return input === '' ? '0,' : `${input},`;
  }
  const comma = input.indexOf(',');
  if (comma >= 0) return input.length - comma > 2 ? input : input + key;
  if (input === '0') return key;
  return input.length >= MAX_INTEGER_DIGITS ? input : input + key;
}

export function keypadInputToCents(input: string): number {
  const [integerPart = '', decimalPart = ''] = input.split(',');
  return Number(integerPart || '0') * 100 + Number(decimalPart.padEnd(2, '0'));
}

export function centsToKeypadInput(cents: number): string {
  const abs = Math.abs(cents);
  if (abs === 0) return '';
  const units = Math.trunc(abs / 100);
  const decimals = abs % 100;
  return decimals === 0 ? String(units) : `${units},${String(decimals).padStart(2, '0')}`;
}

/** Il testo digitato come va mostrato: migliaia separate, decimali come sono stati scritti. */
export function formatKeypadInput(input: string): string {
  if (input === '') return '0';
  const [integerPart = '', decimalPart] = input.split(',');
  const grouped = groupThousands(integerPart);
  return decimalPart === undefined ? grouped : `${grouped},${decimalPart}`;
}

/** Una frazione come percentuale intera: 0,456 diventa 46%. */
export function formatRate(rate: number): string {
  const percent = Math.round(rate * 100);
  return `${percent < 0 ? MINUS : ''}${Math.abs(percent)}%`;
}

/** Un numero con un decimale, per esempio i mesi di autonomia: 2,5. */
export function formatOneDecimal(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

/** Per le scale dei grafici, in euro interi: 800 €, 4.500 €. */
export function formatCentsRounded(cents: number): string {
  const euros = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 && euros > 0 ? MINUS : ''}${groupThousands(String(euros))}${NBSP}€`;
}
