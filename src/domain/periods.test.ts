import { describe, expect, it } from 'vitest';
import { formatMonthShort, formatPeriod, monthStarts, periodMonths, periodRangeFor, shiftPeriod } from './periods';

describe('periodRangeFor', () => {
  it('trova il mese, anche bisestile', () => {
    expect(periodRangeFor('mese', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRangeFor('mese', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('trova il trimestre di calendario', () => {
    expect(periodRangeFor('trimestre', '2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRangeFor('trimestre', '2026-03-31')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodRangeFor('trimestre', '2026-04-01')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(periodRangeFor('trimestre', '2026-10-30')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('trova l’anno', () => {
    expect(periodRangeFor('anno', '2026-10-30')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('shiftPeriod', () => {
  it('si sposta di mesi, trimestri e anni senza perdersi a fine mese', () => {
    expect(shiftPeriod('mese', '2026-03-31', -1)).toBe('2026-02-01');
    expect(shiftPeriod('mese', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftPeriod('trimestre', '2026-10-30', -1)).toBe('2026-07-01');
    expect(shiftPeriod('anno', '2026-10-30', -1)).toBe('2025-10-01');
  });
});

describe('formatPeriod', () => {
  it('scrive il periodo in italiano', () => {
    expect(formatPeriod('mese', periodRangeFor('mese', '2026-10-30'))).toBe('Ottobre 2026');
    expect(formatPeriod('trimestre', periodRangeFor('trimestre', '2026-10-30'))).toBe('Ott–Dic 2026');
    expect(formatPeriod('anno', periodRangeFor('anno', '2026-10-30'))).toBe('2026');
    expect(formatPeriod('personalizzato', { from: '2026-01-15', to: '2026-03-01' })).toBe('15 gen 2026 – 1 mar 2026');
  });

  it('scrive il mese abbreviato per le tabelle', () => {
    expect(formatMonthShort('2026-01-01')).toBe('Gen 2026');
    expect(formatMonthShort('2026-12-31')).toBe('Dic 2026');
  });
});

describe('monthStarts', () => {
  it('elenca i mesi toccati, attraversando l’anno', () => {
    expect(monthStarts('2026-11-15', '2027-01-02')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(monthStarts('2026-10-01', '2026-10-31')).toEqual(['2026-10-01']);
  });
});

describe('periodMonths', () => {
  it('vale 1 per un mese, anche parziale', () => {
    expect(periodMonths('2026-02-01', '2026-02-28')).toBe(1);
    expect(periodMonths('2026-10-01', '2026-10-31')).toBe(1);
    expect(periodMonths('2026-10-01', '2026-10-05')).toBe(1);
  });

  it('vale i mesi interi per trimestri e anni', () => {
    expect(periodMonths('2026-01-01', '2026-03-31')).toBe(3);
    expect(periodMonths('2026-01-01', '2026-12-31')).toBe(12);
    expect(periodMonths('2028-01-01', '2028-12-31')).toBe(12);
  });

  it('per un anno in corso conta i mesi trascorsi', () => {
    expect(periodMonths('2026-01-01', '2026-10-30')).toBe(10);
  });
});
