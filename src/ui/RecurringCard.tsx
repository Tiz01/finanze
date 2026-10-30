import { useMemo } from 'react';
import { useData } from '../db/DataProvider';
import { confirmOccurrence, skipOccurrence } from '../db/recurring';
import { formatShortDate } from '../domain/dates';
import { pendingCount, pendingRecurring, templateAmountText, type PendingRecurring } from '../domain/recurring';
import type { IsoDate } from '../domain/types';
import { openRecurringEntry } from './entryStore';
import { notify, notifyError } from './feedback';

function PendingRow({ item, today }: { item: PendingRecurring; today: IsoDate }) {
  const { accounts, categories } = useData();
  const { recurring, dates } = item;
  const occurrence = dates[0];
  if (!occurrence) return null;

  const { template } = recurring;
  const category = categories.find((entry) => entry.id === template.categoryId);
  const accountName = (id?: string) => accounts.find((account) => account.id === id)?.name ?? '';
  const where =
    template.type === 'trasferimento'
      ? `${accountName(template.accountId)} → ${accountName(template.toAccountId)}`
      : accountName(template.accountId);
  const others = dates.length - 1;

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          style={category ? { backgroundColor: `${category.color}1f` } : undefined}
          className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xl ${category ? '' : 'bg-bg'}`}
        >
          {category?.emoji ?? '⇄'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{recurring.name}</span>
          <span className="block truncate text-xs text-muted">
            {formatShortDate(occurrence, today)} · {where}
          </span>
          {others > 0 && (
            <span className="block text-xs text-muted">
              {others === 1 ? 'e un’altra scadenza dopo questa' : `e altre ${others} scadenze dopo questa`}
            </span>
          )}
        </span>
        <span className={`shrink-0 tabular-nums ${template.type === 'entrata' ? 'text-positive' : ''}`}>
          {templateAmountText(template)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            confirmOccurrence(recurring.id, occurrence).then((undo) => notify('Movimento confermato', undo), notifyError);
          }}
          className="min-h-11 rounded-xl bg-accent px-2 text-sm font-semibold text-on-accent active:opacity-80"
        >
          Conferma
        </button>
        <button
          type="button"
          onClick={() => openRecurringEntry(recurring, occurrence)}
          className="min-h-11 rounded-xl border border-line px-2 text-sm font-semibold active:opacity-80"
        >
          Modifica
        </button>
        <button
          type="button"
          onClick={() => {
            skipOccurrence(recurring.id, occurrence).then((undo) => notify('Scadenza saltata', undo), notifyError);
          }}
          className="min-h-11 rounded-xl border border-line px-2 text-sm font-semibold active:opacity-80"
        >
          Salta
        </button>
      </div>
    </div>
  );
}

export function RecurringCard({ today }: { today: IsoDate }) {
  const { recurring } = useData();
  const pending = useMemo(() => pendingRecurring(recurring, today), [recurring, today]);
  const count = pendingCount(pending);
  if (count === 0) return null;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl bg-surface">
      <h2 className="px-4 pt-3 font-semibold">
        {count === 1 ? '1 movimento ricorrente da confermare' : `${count} movimenti ricorrenti da confermare`}
      </h2>
      <div className="divide-y divide-line">
        {pending.map((item) => (
          <PendingRow key={item.recurring.id} item={item} today={today} />
        ))}
      </div>
    </section>
  );
}
