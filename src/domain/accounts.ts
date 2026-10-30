import type { AccountType } from './types';

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  corrente: 'Conto corrente',
  contanti: 'Contanti',
  deposito: 'Conto deposito',
  carta_prepagata: 'Carta prepagata',
  investimento: 'Investimento',
  altro: 'Altro',
};

export function defaultCountsAsLiquidity(type: AccountType): boolean {
  return type === 'corrente' || type === 'contanti' || type === 'carta_prepagata';
}
