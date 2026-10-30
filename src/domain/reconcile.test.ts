import { describe, expect, it } from 'vitest';
import { lastVerifiedDate, verifiedLabel } from './reconcile';
import type { Account, Reconciliation } from './types';

const account: Account = {
  id: 'a',
  name: 'Corrente',
  type: 'corrente',
  currency: 'EUR',
  initialBalanceCents: 0,
  initialBalanceDate: '2026-06-01',
  archived: false,
  contaComeLiquidita: true,
  createdAt: '2026-06-01T00:00:00.000Z',
};

function reconciliation(accountId: string, date: string): Reconciliation {
  return { id: `${accountId}-${date}`, accountId, date, realBalanceCents: 0 };
}

describe('lastVerifiedDate', () => {
  it('senza riconciliazioni vale la data del saldo iniziale', () => {
    expect(lastVerifiedDate(account, [])).toBe('2026-06-01');
  });

  it('prende la riconciliazione più recente di quel conto', () => {
    const reconciliations = [
      reconciliation('a', '2026-08-01'),
      reconciliation('a', '2026-10-01'),
      reconciliation('a', '2026-09-01'),
      reconciliation('b', '2026-10-30'),
    ];
    expect(lastVerifiedDate(account, reconciliations)).toBe('2026-10-01');
  });

  it('ignora le riconciliazioni precedenti al saldo iniziale', () => {
    expect(lastVerifiedDate(account, [reconciliation('a', '2026-01-01')])).toBe('2026-06-01');
  });
});

describe('verifiedLabel', () => {
  const today = '2026-10-30';

  it('dice oggi, ieri o quanti giorni fa', () => {
    expect(verifiedLabel(today, today)).toBe('verificato oggi');
    expect(verifiedLabel('2026-10-29', today)).toBe('verificato ieri');
    expect(verifiedLabel('2026-10-28', today)).toBe('verificato 2 giorni fa');
    expect(verifiedLabel('2026-01-01', today)).toBe('verificato 302 giorni fa');
  });

  it('non dà numeri negativi se la data è futura', () => {
    expect(verifiedLabel('2026-11-01', today)).toBe('verificato oggi');
  });
});
