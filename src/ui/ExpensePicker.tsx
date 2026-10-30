import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { formatShortDate, todayIso } from '../domain/dates';
import { formatCents } from '../domain/money';
import { compareNewestFirst, filterTransactions, reimbursedTotals } from '../domain/transactions';
import { Button, TextInput } from './controls';
import { Sheet } from './Sheet';

const MAX_RESULTS = 100;

interface ExpensePickerProps {
  skipLabel: string;
  onPick: (expenseId: string) => void;
  onSkip: () => void;
  onClose: () => void;
}

export function ExpensePicker({ skipLabel, onPick, onSkip, onClose }: ExpensePickerProps) {
  const { accounts, categories, transactions } = useData();
  const [query, setQuery] = useState('');
  const today = todayIso();

  const refunded = useMemo(() => reimbursedTotals(transactions), [transactions]);
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const expenses = useMemo(() => {
    const context = {
      accountNames: new Map(accounts.map((account) => [account.id, account.name])),
      categoryNames: new Map(categories.map((category) => [category.id, category.name])),
    };
    return filterTransactions(
      transactions.filter((transaction) => transaction.type === 'uscita'),
      { query },
      context,
    )
      .sort(compareNewestFirst)
      .slice(0, MAX_RESULTS);
  }, [accounts, categories, transactions, query]);

  return (
    <Sheet title="Di quale spesa è il rimborso?" onClose={onClose} tall>
      <div className="space-y-3">
        <TextInput
          type="search"
          placeholder="Cerca per nota, categoria, importo"
          aria-label="Cerca una spesa"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button variant="secondary" className="w-full" onClick={onSkip}>
          {skipLabel}
        </Button>
        {expenses.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Nessuna spesa trovata.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-2xl bg-bg">
            {expenses.map((expense) => {
              const category = expense.categoryId ? categoriesById.get(expense.categoryId) : undefined;
              const already = refunded.get(expense.id);
              return (
                <button
                  key={expense.id}
                  type="button"
                  onClick={() => onPick(expense.id)}
                  className="flex min-h-13 w-full items-center gap-3 px-3 py-2 text-left active:bg-line"
                >
                  <span className="text-xl" aria-hidden="true">
                    {category?.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{expense.note || category?.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {formatShortDate(expense.date, today)}
                      {already ? ` · già rimborsati ${formatCents(already)}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatCents(expense.amountCents)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}
