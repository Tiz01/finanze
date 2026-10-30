import { describe, expect, it } from 'vitest';
import {
  describeFrequency,
  firstOccurrenceOnOrAfter,
  MAX_PENDING_DATES,
  nextOccurrence,
  occurrenceDate,
  pendingCount,
  pendingRecurring,
  templateAmountText,
  validateRule,
} from './recurring';
import type { Recurring, RecurringRule } from './types';

const monthly = (anchorDate: string): RecurringRule => ({ frequency: 'mensile', anchorDate });

function recurring(fields: Partial<Recurring> & Pick<Recurring, 'anchorDate' | 'nextDue'>): Recurring {
  return {
    id: 'r',
    name: 'Affitto',
    frequency: 'mensile',
    active: true,
    template: { type: 'uscita', amountCents: 50000, accountId: 'a', categoryId: 'c' },
    ...fields,
  };
}

describe('occurrenceDate', () => {
  it('una ricorrenza del 31 passa dalla fine di febbraio e torna al 31', () => {
    const rule = monthly('2026-01-31');
    expect(occurrenceDate(rule, 0)).toBe('2026-01-31');
    expect(occurrenceDate(rule, 1)).toBe('2026-02-28');
    expect(occurrenceDate(rule, 2)).toBe('2026-03-31');
    expect(occurrenceDate(rule, 3)).toBe('2026-04-30');
    expect(occurrenceDate(rule, 13)).toBe('2027-02-28');
  });

  it('la ricorrenza annuale del 29 febbraio cade il 28 negli anni non bisestili', () => {
    const rule: RecurringRule = { frequency: 'annuale', anchorDate: '2028-02-29' };
    expect(occurrenceDate(rule, 1)).toBe('2029-02-28');
    expect(occurrenceDate(rule, 4)).toBe('2032-02-29');
  });

  it('gestisce gli intervalli personalizzati', () => {
    const anchorDate = '2026-01-31';
    expect(occurrenceDate({ frequency: 'personalizzata', interval: 10, intervalUnit: 'giorni', anchorDate }, 1)).toBe('2026-02-10');
    expect(occurrenceDate({ frequency: 'personalizzata', interval: 2, intervalUnit: 'settimane', anchorDate }, 1)).toBe('2026-02-14');
    expect(occurrenceDate({ frequency: 'personalizzata', interval: 3, intervalUnit: 'mesi', anchorDate }, 1)).toBe('2026-04-30');
  });

  it('non dipende dal cambio di ora legale', () => {
    const rule: RecurringRule = { frequency: 'personalizzata', interval: 1, intervalUnit: 'giorni', anchorDate: '2026-03-28' };
    expect(occurrenceDate(rule, 1)).toBe('2026-03-29');
    expect(occurrenceDate(rule, 2)).toBe('2026-03-30');
  });
});

describe('nextOccurrence e firstOccurrenceOnOrAfter', () => {
  const rule = monthly('2026-01-31');

  it('nextOccurrence è strettamente successiva alla data', () => {
    expect(nextOccurrence(rule, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(rule, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(rule, '2026-01-01')).toBe('2026-01-31');
  });

  it('firstOccurrenceOnOrAfter può coincidere con la data', () => {
    expect(firstOccurrenceOnOrAfter(rule, '2026-02-28')).toBe('2026-02-28');
    expect(firstOccurrenceOnOrAfter(rule, '2026-03-01')).toBe('2026-03-31');
    expect(firstOccurrenceOnOrAfter(rule, '2025-01-01')).toBe('2026-01-31');
  });
});

describe('pendingRecurring', () => {
  const today = '2026-10-30';

  it('elenca le scadenze arrivate, comprese quelle saltate per giorni o mesi', () => {
    const pending = pendingRecurring([recurring({ anchorDate: '2026-08-01', nextDue: '2026-08-01' })], today);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.dates).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(pendingCount(pending)).toBe(3);
  });

  it('una scadenza di oggi è già da confermare, quella di domani no', () => {
    expect(pendingCount(pendingRecurring([recurring({ anchorDate: '2026-10-30', nextDue: today })], today))).toBe(1);
    expect(pendingCount(pendingRecurring([recurring({ anchorDate: '2026-10-31', nextDue: '2026-10-31' })], today))).toBe(0);
  });

  it('una ricorrenza giornaliera molto vecchia non blocca l’app e si limita alle prime scadenze', () => {
    const daily = recurring({
      frequency: 'personalizzata',
      interval: 1,
      intervalUnit: 'giorni',
      anchorDate: '1900-01-01',
      nextDue: '1900-01-01',
    });
    const pending = pendingRecurring([daily], today);
    expect(pending[0]?.dates).toHaveLength(MAX_PENDING_DATES);
    expect(pending[0]?.dates[0]).toBe('1900-01-01');
    expect(pending[0]?.dates[1]).toBe('1900-01-02');
    expect(nextOccurrence(daily, '2026-10-29')).toBe('2026-10-30');
  });

  it('propone la scadenza salvata anche se non cade su una data della regola', () => {
    const pending = pendingRecurring([recurring({ anchorDate: '2026-08-10', nextDue: '2026-09-02' })], today);
    expect(pending[0]?.dates).toEqual(['2026-09-02', '2026-09-10', '2026-10-10']);
  });

  it('ignora le ricorrenze sospese', () => {
    expect(pendingRecurring([recurring({ anchorDate: '2026-01-01', nextDue: '2026-01-01', active: false })], today)).toEqual([]);
  });

  it('parte dalla prossima scadenza, non dalla prima', () => {
    const pending = pendingRecurring([recurring({ anchorDate: '2026-01-15', nextDue: '2026-10-15' })], today);
    expect(pending[0]?.dates).toEqual(['2026-10-15']);
  });

  it('ordina dalla scadenza più vecchia', () => {
    const pending = pendingRecurring(
      [
        recurring({ id: 'b', name: 'Palestra', anchorDate: '2026-10-05', nextDue: '2026-10-05' }),
        recurring({ id: 'a', name: 'Affitto', anchorDate: '2026-10-01', nextDue: '2026-10-01' }),
      ],
      today,
    );
    expect(pending.map((item) => item.recurring.id)).toEqual(['a', 'b']);
  });
});

describe('describeFrequency', () => {
  const anchorDate = '2026-01-01';

  it('descrive le frequenze in italiano', () => {
    expect(describeFrequency({ frequency: 'mensile', anchorDate })).toBe('Ogni mese');
    expect(describeFrequency({ frequency: 'annuale', anchorDate })).toBe('Ogni anno');
    expect(describeFrequency({ frequency: 'personalizzata', interval: 2, intervalUnit: 'settimane', anchorDate })).toBe('Ogni 2 settimane');
    expect(describeFrequency({ frequency: 'personalizzata', interval: 1, intervalUnit: 'settimane', anchorDate })).toBe('Ogni settimana');
    expect(describeFrequency({ frequency: 'personalizzata', interval: 3, intervalUnit: 'mesi', anchorDate })).toBe('Ogni 3 mesi');
    expect(describeFrequency({ frequency: 'personalizzata', interval: 10, intervalUnit: 'giorni', anchorDate })).toBe('Ogni 10 giorni');
  });
});

describe('templateAmountText', () => {
  it('mostra il segno secondo il tipo di movimento', () => {
    const base = { accountId: 'a', amountCents: 1250 };
    expect(templateAmountText({ ...base, type: 'uscita' })).toBe('−12,50 €');
    expect(templateAmountText({ ...base, type: 'entrata' })).toBe('+12,50 €');
    expect(templateAmountText({ ...base, type: 'trasferimento' })).toBe('12,50 €');
  });
});

describe('validateRule', () => {
  const anchorDate = '2026-01-01';

  it('accetta le frequenze fisse senza intervallo', () => {
    expect(validateRule({ frequency: 'mensile', anchorDate })).toBeNull();
    expect(validateRule({ frequency: 'annuale', anchorDate })).toBeNull();
  });

  it('richiede un intervallo intero positivo per quella personalizzata', () => {
    const base = { frequency: 'personalizzata', intervalUnit: 'giorni', anchorDate } as const;
    expect(validateRule({ ...base, interval: 7 })).toBeNull();
    expect(validateRule({ ...base, interval: 0 })).not.toBeNull();
    expect(validateRule({ ...base, interval: 1.5 })).not.toBeNull();
    expect(validateRule({ ...base })).not.toBeNull();
    expect(validateRule({ frequency: 'personalizzata', interval: 2, anchorDate })).not.toBeNull();
  });
});
