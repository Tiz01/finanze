import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../db/DataProvider';
import { deleteTransaction, duplicateTransaction } from '../db/transactions';
import { formatDayHeading, todayIso } from '../domain/dates';
import { formatCents, formatSignedCents } from '../domain/money';
import {
  compareNewestFirst,
  filterTransactions,
  groupByDay,
  PERIOD_PRESETS,
  periodRange,
  reimbursedTotals,
  type PeriodPreset,
} from '../domain/transactions';
import type { Account, Category, Transaction } from '../domain/types';
import { Field, ListGroup, SelectChip, TextInput } from '../ui/controls';
import { openEditEntry } from '../ui/entryStore';
import { notify, notifyError, undoLastAction, useFeedback } from '../ui/feedback';
import { Screen } from '../ui/Screen';
import { SwipeRow, type SwipeAction } from '../ui/SwipeRow';

const PAGE_SIZE = 150;

function amountView(transaction: Transaction): { text: string; className: string } {
  switch (transaction.type) {
    case 'uscita':
      return { text: formatCents(-transaction.amountCents), className: '' };
    case 'entrata':
      return { text: formatSignedCents(transaction.amountCents), className: 'text-positive' };
    case 'trasferimento':
      return { text: formatCents(transaction.amountCents), className: 'text-muted' };
    case 'rettifica':
      return { text: formatSignedCents(transaction.amountCents), className: 'text-muted' };
  }
}

interface RowLookups {
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  transactions: Map<string, Transaction>;
  refunded: Map<string, number>;
}

function TransactionRow({ transaction, lookups }: { transaction: Transaction; lookups: RowLookups }) {
  const category = transaction.categoryId ? lookups.categories.get(transaction.categoryId) : undefined;
  const accountName = lookups.accounts.get(transaction.accountId)?.name ?? '';
  const amount = amountView(transaction);

  const fallback = transaction.type === 'trasferimento' ? 'Trasferimento' : 'Rettifica';
  const title = transaction.note || category?.name || fallback;
  const details =
    transaction.type === 'trasferimento'
      ? `${accountName} → ${transaction.toAccountId ? (lookups.accounts.get(transaction.toAccountId)?.name ?? '') : ''}`
      : [transaction.note ? category?.name : undefined, accountName].filter(Boolean).join(' · ');

  const refunded = lookups.refunded.get(transaction.id);
  const original = transaction.reimbursesId ? lookups.transactions.get(transaction.reimbursesId) : undefined;
  const originalCategory = original?.categoryId ? lookups.categories.get(original.categoryId) : undefined;

  return (
    <div className="flex min-h-14 items-center gap-3 px-3 py-2">
      <span
        aria-hidden="true"
        style={category ? { backgroundColor: `${category.color}1f` } : undefined}
        className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xl ${category ? '' : 'bg-bg'}`}
      >
        {category?.emoji ?? '⇄'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{title}</span>
        <span className="block truncate text-xs text-muted">{details}</span>
        {refunded !== undefined && (
          <span className="block truncate text-xs text-positive">Rimborsati {formatCents(refunded)}</span>
        )}
        {original && (
          <span className="block truncate text-xs text-muted">
            Rimborso di: {original.note || originalCategory?.name}
          </span>
        )}
      </span>
      <span className={`shrink-0 tabular-nums ${amount.className}`}>{amount.text}</span>
    </div>
  );
}

export function Movimenti() {
  const { accounts, categories, transactions } = useData();
  const { lastUndo } = useFeedback();
  const today = todayIso();

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [period, setPeriod] = useState<PeriodPreset>('tutto');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  const filtersActive = query !== '' || categoryId !== '' || accountId !== '' || period !== 'tutto';

  const filtered = useMemo(() => {
    const range =
      period === 'personalizzato'
        ? { from: customFrom || undefined, to: customTo || undefined }
        : periodRange(period, today);
    const context = {
      accountNames: new Map(accounts.map((account) => [account.id, account.name])),
      categoryNames: new Map(categories.map((category) => [category.id, category.name])),
    };
    return filterTransactions(
      transactions,
      { query, categoryId: categoryId || undefined, accountId: accountId || undefined, ...range },
      context,
    ).sort(compareNewestFirst);
  }, [accounts, categories, transactions, query, categoryId, accountId, period, customFrom, customTo, today]);

  useEffect(() => setLimit(PAGE_SIZE), [query, categoryId, accountId, period, customFrom, customTo]);

  const hasMore = filtered.length > limit;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setLimit((current) => current + PAGE_SIZE);
      },
      { rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, limit]);

  const groups = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit]);

  const lookups = useMemo<RowLookups>(
    () => ({
      accounts: new Map(accounts.map((account) => [account.id, account])),
      categories: new Map(categories.map((category) => [category.id, category])),
      transactions: new Map(transactions.map((transaction) => [transaction.id, transaction])),
      refunded: reimbursedTotals(transactions),
    }),
    [accounts, categories, transactions],
  );

  function actionsFor(transaction: Transaction): SwipeAction[] {
    const remove: SwipeAction = {
      label: 'Elimina',
      tone: 'danger',
      onPress: () => {
        deleteTransaction(transaction.id).then((undo) => notify('Movimento eliminato', undo), notifyError);
      },
    };
    if (transaction.type === 'rettifica') return [remove];
    return [
      {
        label: 'Duplica',
        tone: 'accent',
        onPress: () => {
          duplicateTransaction(transaction.id, today).then((undo) => notify('Movimento duplicato con la data di oggi', undo), notifyError);
        },
      },
      { label: 'Modifica', tone: 'neutral', onPress: () => openEditEntry(transaction) },
      remove,
    ];
  }

  function clearFilters() {
    setQuery('');
    setCategoryId('');
    setAccountId('');
    setPeriod('tutto');
    setCustomFrom('');
    setCustomTo('');
  }

  const categoryLabel = categories.find((category) => category.id === categoryId)?.name ?? 'Categoria';
  const accountLabel = accounts.find((account) => account.id === accountId)?.name ?? 'Conto';
  const periodLabel = PERIOD_PRESETS.find((preset) => preset.id === period)?.label ?? 'Periodo';

  return (
    <Screen
      title="Movimenti"
      action={
        lastUndo && (
          <button type="button" onClick={() => void undoLastAction()} className="-my-1.5 min-h-11 shrink-0 px-1 text-sm font-semibold text-accent">
            Annulla ultima azione
          </button>
        )
      }
    >
      <div className="space-y-2 pb-2">
        <TextInput
          type="search"
          placeholder="Cerca per nota, categoria, conto, importo"
          aria-label="Cerca movimenti"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <SelectChip
            label={categoryLabel}
            ariaLabel="Filtra per categoria"
            value={categoryId}
            onChange={setCategoryId}
            active={categoryId !== ''}
            options={[
              { value: '', label: 'Tutte le categorie' },
              ...categories.map((category) => ({ value: category.id, label: `${category.emoji} ${category.name}` })),
            ]}
          />
          <SelectChip
            label={accountLabel}
            ariaLabel="Filtra per conto"
            value={accountId}
            onChange={setAccountId}
            active={accountId !== ''}
            options={[
              { value: '', label: 'Tutti i conti' },
              ...accounts.map((account) => ({ value: account.id, label: account.name })),
            ]}
          />
          <SelectChip
            label={period === 'tutto' ? 'Periodo' : periodLabel}
            ariaLabel="Filtra per periodo"
            value={period}
            onChange={(value) => setPeriod(value as PeriodPreset)}
            active={period !== 'tutto'}
            options={PERIOD_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
          />
        </div>
        {period === 'personalizzato' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Dal">
              <TextInput type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} />
            </Field>
            <Field label="Al">
              <TextInput type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} />
            </Field>
          </div>
        )}
        {filtersActive && (
          <p className="flex items-center justify-between px-1 text-sm text-muted">
            <span>
              {filtered.length} {filtered.length === 1 ? 'movimento' : 'movimenti'}
            </span>
            <button type="button" onClick={clearFilters} className="min-h-10 font-medium text-accent">
              Azzera filtri
            </button>
          </p>
        )}
      </div>

      {filtered.length === 0 && (
        <p className="pt-8 text-center text-muted">
          {transactions.length === 0 ? 'Nessun movimento. Tocca + per iniziare.' : 'Nessun movimento con questi filtri.'}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.date}>
          <h2 className="sticky top-0 z-10 bg-bg px-1 py-2 text-sm font-semibold text-muted">
            {formatDayHeading(group.date, today)}
          </h2>
          <ListGroup>
            {group.transactions.map((transaction) => (
              <SwipeRow
                key={transaction.id}
                actions={actionsFor(transaction)}
                onTap={transaction.type === 'rettifica' ? undefined : () => openEditEntry(transaction)}
              >
                <TransactionRow transaction={transaction} lookups={lookups} />
              </SwipeRow>
            ))}
          </ListGroup>
        </section>
      ))}
      {hasMore && <div ref={sentinel} className="h-1" />}
    </Screen>
  );
}
