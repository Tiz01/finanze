import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './categories';
import { matchRule, suggestRuleText } from './importRules';
import type { Account, Category, ImportRule } from './types';

const categories = [...DEFAULT_CATEGORIES];

function account(id: string, archived = false): Account {
  return {
    id,
    name: id,
    type: 'corrente',
    currency: 'EUR',
    initialBalanceCents: 0,
    initialBalanceDate: '2026-01-01',
    archived,
    contaComeLiquidita: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const context = { accountId: 'corrente', accounts: [account('corrente'), account('deposito'), account('vecchio', true)], categories };

function rule(contains: string, categoryId: string): ImportRule {
  return { id: contains, contains, categoryId };
}

describe('matchRule', () => {
  it('trova il testo ovunque nella descrizione, senza badare a maiuscole e accenti', () => {
    const rules = [rule('supermercato', 'cat-spesa')];
    expect(matchRule(rules, context, 'PAG. POS 12/10 SUPERMERCATO ROSSI MILANO', 'uscita')?.categoryId).toBe('cat-spesa');
    expect(matchRule([rule('caffè', 'cat-ristoranti')], context, 'CAFFE CENTRALE', 'uscita')?.categoryId).toBe('cat-ristoranti');
    expect(matchRule([rule('caffe', 'cat-ristoranti')], context, 'Caffè  centrale', 'uscita')?.categoryId).toBe('cat-ristoranti');
  });

  it('senza corrispondenze non restituisce niente', () => {
    expect(matchRule([rule('rossi', 'cat-spesa')], context, 'BIANCHI', 'uscita')).toBeNull();
    expect(matchRule([], context, 'BIANCHI', 'uscita')).toBeNull();
  });

  it('vince il testo più lungo, in qualunque ordine siano le regole', () => {
    const general = rule('rossi', 'cat-spesa');
    const specific = rule('rossi bar', 'cat-ristoranti');
    expect(matchRule([general, specific], context, 'ROSSI BAR', 'uscita')).toBe(specific);
    expect(matchRule([specific, general], context, 'ROSSI BAR', 'uscita')).toBe(specific);
    expect(matchRule([specific, general], context, 'ROSSI MARKET', 'uscita')).toBe(general);
  });

  it('una regola di spesa non tocca le entrate, e viceversa', () => {
    const spesa = rule('rossi', 'cat-spesa');
    const rimborso = rule('rossi', 'cat-rimborsi');
    expect(matchRule([spesa], context, 'ROSSI', 'entrata')).toBeNull();
    expect(matchRule([rimborso], context, 'ROSSI', 'uscita')).toBeNull();
    expect(matchRule([spesa, rimborso], context, 'ROSSI', 'entrata')).toBe(rimborso);
  });

  it('ignora le categorie archiviate o eliminate', () => {
    const archived: Category[] = categories.map((category) => ({ ...category, archived: category.id === 'cat-spesa' }));
    expect(matchRule([rule('rossi', 'cat-spesa')], { ...context, categories: archived }, 'ROSSI', 'uscita')).toBeNull();
    expect(matchRule([rule('rossi', 'non-esiste')], context, 'ROSSI', 'uscita')).toBeNull();
  });

  it('una regola senza testo non vale per tutto', () => {
    expect(matchRule([rule('   ', 'cat-spesa')], context, 'ROSSI', 'uscita')).toBeNull();
  });
});

describe('regole di trasferimento', () => {
  const trasferimento: ImportRule = { id: 't', contains: 'deposito', transferAccountId: 'deposito' };

  it('valgono nei due sensi', () => {
    expect(matchRule([trasferimento], context, 'BONIFICO VERSO DEPOSITO', 'uscita')).toBe(trasferimento);
    expect(matchRule([trasferimento], context, 'BONIFICO DA DEPOSITO', 'entrata')).toBe(trasferimento);
  });

  it('non valgono sul conto stesso: gli interessi del deposito restano entrate', () => {
    expect(matchRule([trasferimento], { ...context, accountId: 'deposito' }, 'INTERESSI DEPOSITO', 'entrata')).toBeNull();
  });

  it('ignorano i conti archiviati o eliminati', () => {
    expect(matchRule([{ ...trasferimento, transferAccountId: 'vecchio' }], context, 'DEPOSITO', 'uscita')).toBeNull();
    expect(matchRule([{ ...trasferimento, transferAccountId: 'boh' }], context, 'DEPOSITO', 'uscita')).toBeNull();
  });

  it('anche tra regole di tipo diverso vince il testo più lungo', () => {
    const generale = rule('bonifico', 'cat-altro');
    expect(matchRule([generale, trasferimento], context, 'BONIFICO DEPOSITO', 'uscita')).toBe(generale);
    const preciso: ImportRule = { ...trasferimento, contains: 'bonifico deposito' };
    expect(matchRule([generale, preciso], context, 'BONIFICO DEPOSITO', 'uscita')).toBe(preciso);
  });
});

describe('suggestRuleText', () => {
  it.each([
    ['PAGAMENTO POS 12/10 SUPERMERCATO ROSSI MILANO CARTA 1234', 'SUPERMERCATO'],
    ['Pagamento Apple Pay presso Palestra Centro', 'PALESTRA'],
    ['ADDEBITO SDD BOLLETTA LUCE', 'BOLLETTA'],
    ['Rossi', 'ROSSI'],
    ['BONIFICO VERSO CONTO RISPARMIO', 'RISPARMIO'],
    ['Giroconto a favore di Broker', 'BROKER'],
  ])('da %s propone %s', (description, expected) => {
    expect(suggestRuleText(description)).toBe(expected);
  });

  it('senza parole utili propone l’inizio della descrizione', () => {
    expect(suggestRuleText('POS 1234 5678')).toBe('POS 1234 5678');
    expect(suggestRuleText('')).toBe('');
  });
});
