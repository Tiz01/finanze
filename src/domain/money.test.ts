import { describe, expect, it } from 'vitest';
import {
  applyKeypadKey,
  centsToKeypadInput,
  formatCents,
  formatKeypadInput,
  formatSignedCents,
  keypadInputToCents,
  parseAmount,
  type KeypadKey,
} from './money';

const NBSP = ' ';
const MINUS = '−';

describe('formatCents', () => {
  it('usa il formato italiano, separando anche le migliaia a 4 cifre', () => {
    expect(formatCents(123456)).toBe(`1.234,56${NBSP}€`);
    expect(formatCents(100000000)).toBe(`1.000.000,00${NBSP}€`);
    expect(formatCents(5)).toBe(`0,05${NBSP}€`);
    expect(formatCents(0)).toBe(`0,00${NBSP}€`);
  });

  it('mostra il segno negativo', () => {
    expect(formatCents(-1250)).toBe(`${MINUS}12,50${NBSP}€`);
  });

  it('mostra il codice per le valute senza simbolo', () => {
    expect(formatCents(100, 'USD')).toBe(`1,00${NBSP}USD`);
  });

  it('formatSignedCents aggiunge il + alle somme positive', () => {
    expect(formatSignedCents(1250)).toBe(`+12,50${NBSP}€`);
    expect(formatSignedCents(-1250)).toBe(`${MINUS}12,50${NBSP}€`);
    expect(formatSignedCents(0)).toBe(`0,00${NBSP}€`);
  });
});

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['12,5', 1250],
    ['12,50', 1250],
    ['0,05', 5],
    [',5', 50],
    ['12', 1200],
    ['12,', 1200],
    ['1.234', 123400],
    ['1.234.567', 123456700],
    ['12.50', 1250],
    ['1,234.56', 123456],
    [' 1.234,56 € ', 123456],
    [`1.234,56${NBSP}€`, 123456],
    ['-12,50', -1250],
    [`${MINUS}12,50`, -1250],
    ['+12,50', 1250],
    ['0', 0],
    ['-0', 0],
  ])('%s → %d centesimi', (text, cents) => {
    expect(parseAmount(text)).toBe(cents);
  });

  it.each(['', 'abc', '1,234', '12,345', '1.23.4', '12,3,4', '1.234,56,7', '€', '-', '1.2.3,50', '1,234,567.8.9'])(
    'rifiuta %j',
    (text) => {
      expect(parseAmount(text)).toBeNull();
    },
  );

  it('non perde centesimi come farebbero i float', () => {
    expect(parseAmount('0,07')).toBe(7);
    expect(parseAmount('1,10')).toBe(110);
    expect(parseAmount('4,35')).toBe(435);
    expect(parseAmount('1.001,29')).toBe(100129);
  });

  it('rifiuta importi fuori scala', () => {
    expect(parseAmount('99999999999999999999')).toBeNull();
  });
});

describe('tastierino', () => {
  const type = (keys: KeypadKey[]) => keys.reduce(applyKeypadKey, '');

  it('compone un importo con decimali', () => {
    expect(type(['1', '2', ',', '5'])).toBe('12,5');
    expect(keypadInputToCents('12,5')).toBe(1250);
    expect(keypadInputToCents('12,05')).toBe(1205);
    expect(keypadInputToCents('12')).toBe(1200);
    expect(keypadInputToCents('12,')).toBe(1200);
    expect(keypadInputToCents('')).toBe(0);
  });

  it('non accetta più di due decimali né una seconda virgola', () => {
    expect(type(['1', ',', '2', '3', '4'])).toBe('1,23');
    expect(type(['1', ',', ','])).toBe('1,');
  });

  it('gestisce lo zero iniziale e la virgola come primo tasto', () => {
    expect(type(['0', '5'])).toBe('5');
    expect(type(['0', '0'])).toBe('0');
    expect(type([','])).toBe('0,');
    expect(keypadInputToCents('0,')).toBe(0);
  });

  it('cancella un carattere alla volta', () => {
    expect(type(['1', ',', '5', 'back'])).toBe('1,');
    expect(type(['1', ',', 'back'])).toBe('1');
    expect(type(['back'])).toBe('');
  });

  it('limita le cifre intere', () => {
    expect(type(Array<KeypadKey>(12).fill('9'))).toBe('999999999');
  });

  it('converte dai centesimi per la modifica', () => {
    expect(centsToKeypadInput(1250)).toBe('12,50');
    expect(centsToKeypadInput(1205)).toBe('12,05');
    expect(centsToKeypadInput(1200)).toBe('12');
    expect(centsToKeypadInput(0)).toBe('');
    expect(centsToKeypadInput(-1250)).toBe('12,50');
  });

  it('mostra il testo digitato con le migliaia', () => {
    expect(formatKeypadInput('')).toBe('0');
    expect(formatKeypadInput('1234')).toBe('1.234');
    expect(formatKeypadInput('1234,5')).toBe('1.234,5');
    expect(formatKeypadInput('1234,')).toBe('1.234,');
  });
});
