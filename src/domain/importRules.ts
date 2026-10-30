import { plainText } from './statementMapping';
import type { Category, ImportRule } from './types';

const IGNORED_WORDS = new Set(
  `pagamento pagamenti pos carta carte addebito addebiti accredito bonifico sepa sdd diretto favore disposizione disposto
  acquisto prelievo bancomat tramite presso del della dello dei di da in su per con al alla ore vs ordine esercente
  operazione contactless nfc apple google pay eur euro maestro visa mastercard debit credit cod rif num data commissione`
    .split(/\s+/),
);

/**
 * La regola da usare per una riga: se ne valgono più di una vince il testo più lungo, che è il più preciso.
 * Una regola con una categoria di spesa non tocca le entrate, e viceversa.
 */
export function matchRule(
  rules: ImportRule[],
  categories: Category[],
  description: string,
  kind: 'entrata' | 'uscita',
): ImportRule | null {
  const text = plainText(description);
  const usable = new Set(categories.filter((category) => category.kind === kind && !category.archived).map(({ id }) => id));
  let winner: ImportRule | null = null;
  let winnerLength = 0;
  for (const rule of rules) {
    const contains = plainText(rule.contains);
    if (contains.length > winnerLength && usable.has(rule.categoryId) && text.includes(contains)) {
      winner = rule;
      winnerLength = contains.length;
    }
  }
  return winner;
}

/** Il testo da proporre per una nuova regola: la prima parola che non è gergo bancario. */
export function suggestRuleText(description: string): string {
  const words = description.toUpperCase().split(/[\s*/,;:]+/);
  const useful = words.find((word) => /^\p{L}[\p{L}'&.-]{2,}$/u.test(word) && !IGNORED_WORDS.has(plainText(word)));
  return useful ?? description.trim().slice(0, 20).toUpperCase();
}
