import { plainText } from './statementMapping';
import type { Account, Category, ImportRule } from './types';

export interface RuleContext {
  /** Il conto su cui si importa: un trasferimento con se stesso non ha senso. */
  accountId: string;
  accounts: Account[];
  categories: Category[];
}

const IGNORED_WORDS = new Set(
  `pagamento pagamenti pos carta carte addebito addebiti accredito bonifico sepa sdd diretto favore disposizione disposto
  acquisto prelievo bancomat tramite presso del della dello dei di da in su per con al alla ore vs ordine esercente
  operazione contactless nfc apple google pay eur euro maestro visa mastercard debit credit cod rif num data commissione
  verso conto giroconto trasferimento transfer ricevuto effettuato istantaneo ricorrente`
    .split(/\s+/),
);

/**
 * La regola da usare per una riga: se ne valgono più di una vince il testo più lungo, che è il più preciso.
 * Una regola con una categoria di spesa non tocca le entrate, e viceversa; un trasferimento vale nei due sensi.
 */
export function matchRule(
  rules: ImportRule[],
  { accountId, accounts, categories }: RuleContext,
  description: string,
  kind: 'entrata' | 'uscita',
): ImportRule | null {
  const text = plainText(description);
  const usableCategories = new Set(categories.filter((category) => category.kind === kind && !category.archived).map(({ id }) => id));
  const usableAccounts = new Set(accounts.filter((account) => !account.archived && account.id !== accountId).map(({ id }) => id));
  let winner: ImportRule | null = null;
  let winnerLength = 0;
  for (const rule of rules) {
    const contains = plainText(rule.contains);
    const usable = rule.transferAccountId ? usableAccounts.has(rule.transferAccountId) : usableCategories.has(rule.categoryId ?? '');
    if (usable && contains.length > winnerLength && text.includes(contains)) {
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
