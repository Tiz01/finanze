import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from './categories';
import { matchRule, suggestRuleText } from './importRules';
import type { Category, ImportRule } from './types';

const categories = [...DEFAULT_CATEGORIES];

function rule(contains: string, categoryId: string): ImportRule {
  return { id: contains, contains, categoryId };
}

describe('matchRule', () => {
  it('trova il testo ovunque nella descrizione, senza badare a maiuscole e accenti', () => {
    const rules = [rule('supermercato', 'cat-spesa')];
    expect(matchRule(rules, categories, 'PAG. POS 12/10 SUPERMERCATO ROSSI MILANO', 'uscita')?.categoryId).toBe('cat-spesa');
    expect(matchRule([rule('caffè', 'cat-ristoranti')], categories, 'CAFFE CENTRALE', 'uscita')?.categoryId).toBe('cat-ristoranti');
    expect(matchRule([rule('caffe', 'cat-ristoranti')], categories, 'Caffè  centrale', 'uscita')?.categoryId).toBe('cat-ristoranti');
  });

  it('senza corrispondenze non restituisce niente', () => {
    expect(matchRule([rule('rossi', 'cat-spesa')], categories, 'BIANCHI', 'uscita')).toBeNull();
    expect(matchRule([], categories, 'BIANCHI', 'uscita')).toBeNull();
  });

  it('vince il testo più lungo, in qualunque ordine siano le regole', () => {
    const general = rule('rossi', 'cat-spesa');
    const specific = rule('rossi bar', 'cat-ristoranti');
    expect(matchRule([general, specific], categories, 'ROSSI BAR', 'uscita')).toBe(specific);
    expect(matchRule([specific, general], categories, 'ROSSI BAR', 'uscita')).toBe(specific);
    expect(matchRule([specific, general], categories, 'ROSSI MARKET', 'uscita')).toBe(general);
  });

  it('una regola di spesa non tocca le entrate, e viceversa', () => {
    const spesa = rule('rossi', 'cat-spesa');
    const rimborso = rule('rossi', 'cat-rimborsi');
    expect(matchRule([spesa], categories, 'ROSSI', 'entrata')).toBeNull();
    expect(matchRule([rimborso], categories, 'ROSSI', 'uscita')).toBeNull();
    expect(matchRule([spesa, rimborso], categories, 'ROSSI', 'entrata')).toBe(rimborso);
  });

  it('ignora le categorie archiviate o eliminate', () => {
    const archived: Category[] = categories.map((category) => ({ ...category, archived: category.id === 'cat-spesa' }));
    expect(matchRule([rule('rossi', 'cat-spesa')], archived, 'ROSSI', 'uscita')).toBeNull();
    expect(matchRule([rule('rossi', 'non-esiste')], categories, 'ROSSI', 'uscita')).toBeNull();
  });

  it('una regola senza testo non vale per tutto', () => {
    expect(matchRule([rule('   ', 'cat-spesa')], categories, 'ROSSI', 'uscita')).toBeNull();
  });
});

describe('suggestRuleText', () => {
  it.each([
    ['PAGAMENTO POS 12/10 SUPERMERCATO ROSSI MILANO CARTA 1234', 'SUPERMERCATO'],
    ['Pagamento Apple Pay presso Palestra Centro', 'PALESTRA'],
    ['ADDEBITO SDD BOLLETTA LUCE', 'BOLLETTA'],
    ['Rossi', 'ROSSI'],
  ])('da %s propone %s', (description, expected) => {
    expect(suggestRuleText(description)).toBe(expected);
  });

  it('senza parole utili propone l’inizio della descrizione', () => {
    expect(suggestRuleText('POS 1234 5678')).toBe('POS 1234 5678');
    expect(suggestRuleText('')).toBe('');
  });
});
