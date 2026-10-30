import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { addTransaction, editTransaction } from '../db/transactions';
import { CATEGORY_IDS } from '../domain/categories';
import { formatShortDate, todayIso } from '../domain/dates';
import {
  applyKeypadKey,
  centsToKeypadInput,
  formatCents,
  formatKeypadInput,
  keypadInputToCents,
} from '../domain/money';
import { defaultAccountId, parseTags, rankCategories, validateTransaction } from '../domain/transactions';
import type { Account, Category, Transaction, TransactionDraft } from '../domain/types';
import { routeHref } from '../router';
import { Button, ButtonLink, DateChip, Field, Segmented, SelectChip, TextInput } from './controls';
import { closeEntry, entryStore, type EntryRequest } from './entryStore';
import { ExpensePicker } from './ExpensePicker';
import { notify } from './feedback';
import { Keypad } from './Keypad';
import { Sheet } from './Sheet';
import { useStore } from './store';

const TYPE_OPTIONS = [
  { value: 'uscita', label: 'Uscita' },
  { value: 'entrata', label: 'Entrata' },
  { value: 'trasferimento', label: 'Trasferimento' },
] as const;
type EntryType = (typeof TYPE_OPTIONS)[number]['value'];

export function EntrySheet() {
  const request = useStore(entryStore);
  const { accounts } = useData();
  if (!request) return null;
  if (request.mode === 'new' && !accounts.some((account) => !account.archived)) return <NoAccounts />;
  return <EntryForm key={request.mode === 'edit' ? request.transaction.id : 'new'} request={request} />;
}

function NoAccounts() {
  return (
    <Sheet title="Prima crea un conto" onClose={closeEntry}>
      <p className="pb-4 text-muted">Ogni movimento appartiene a un conto: aggiungine uno con il saldo di oggi.</p>
      <div onClick={closeEntry}>
        <ButtonLink href={routeHref('impostazioni/conti')}>Vai ai conti</ButtonLink>
      </div>
    </Sheet>
  );
}

function otherAccountId(accounts: Account[], excluded: string | undefined): string | undefined {
  return accounts.find((account) => account.id !== excluded)?.id;
}

function blurOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') event.currentTarget.blur();
}

function EntryForm({ request }: { request: EntryRequest }) {
  const { accounts, categories, transactions } = useData();
  const today = todayIso();
  const editing: Transaction | null = request.mode === 'edit' ? request.transaction : null;

  const selectableAccounts = accounts.filter(
    (account) => !account.archived || account.id === editing?.accountId || account.id === editing?.toAccountId,
  );

  const [type, setType] = useState<EntryType>(editing && editing.type !== 'rettifica' ? editing.type : 'uscita');
  const [input, setInput] = useState(editing ? centsToKeypadInput(editing.amountCents) : '');
  const [accountId, setAccountId] = useState(
    editing?.accountId ?? defaultAccountId(accounts, transactions, 'uscita') ?? '',
  );
  const [toAccountId, setToAccountId] = useState(
    editing?.toAccountId ?? otherAccountId(selectableAccounts, accountId) ?? '',
  );
  const [date, setDate] = useState(editing?.date ?? today);
  const [categoryId, setCategoryId] = useState(editing?.categoryId);
  const [reimbursesId, setReimbursesId] = useState(editing?.reimbursesId);
  const [note, setNote] = useState(editing?.note ?? '');
  const [tagsText, setTagsText] = useState(editing?.tags?.join(', ') ?? '');
  const [showDetails, setShowDetails] = useState(Boolean(editing?.note || editing?.tags?.length));
  const [pickingExpense, setPickingExpense] = useState(false);
  const [hint, setHint] = useState('');

  const cents = keypadInputToCents(input);

  const tiles = useMemo(() => {
    if (type === 'trasferimento') return [];
    const ranked = rankCategories(categories, transactions, type, today);
    const current = categories.find((category) => category.id === categoryId);
    return current && current.kind === type && !ranked.includes(current) ? [current, ...ranked] : ranked;
  }, [categories, transactions, type, today, categoryId]);

  const accountOptions = selectableAccounts.map((account) => ({ value: account.id, label: account.name }));
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? 'Scegli';

  function changeType(next: EntryType) {
    setType(next);
    setCategoryId(undefined);
    setReimbursesId(undefined);
    setHint('');
    if (!editing && next !== 'trasferimento') {
      setAccountId(defaultAccountId(accounts, transactions, next) ?? accountId);
    }
  }

  function changeFrom(next: string) {
    setAccountId(next);
    if (next === toAccountId) setToAccountId(otherAccountId(selectableAccounts, next) ?? '');
    setHint('');
  }

  async function save(fields: { categoryId?: string; reimbursesId?: string }) {
    const chosenCategory = fields.categoryId ?? categoryId;
    const draft: TransactionDraft = {
      date,
      amountCents: cents,
      type,
      accountId,
      note,
      tags: parseTags(tagsText),
    };
    if (type === 'trasferimento') {
      draft.toAccountId = toAccountId;
    } else {
      draft.categoryId = chosenCategory;
      if (type === 'entrata' && chosenCategory === CATEGORY_IDS.rimborsi) draft.reimbursesId = fields.reimbursesId;
    }

    if (cents <= 0) {
      setHint('Inserisci prima l’importo');
      return;
    }
    const problem = validateTransaction(draft);
    if (problem) {
      setHint(problem);
      return;
    }
    try {
      const undo = editing ? await editTransaction(editing.id, draft) : await addTransaction(draft);
      closeEntry();
      notify(editing ? 'Movimento modificato' : 'Movimento salvato', undo);
    } catch (error) {
      setHint(error instanceof Error ? error.message : 'Non è stato possibile salvare');
    }
  }

  function pressCategory(category: Category) {
    setHint('');
    if (editing) {
      setCategoryId(category.id);
      if (category.id !== CATEGORY_IDS.rimborsi) setReimbursesId(undefined);
      return;
    }
    if (cents <= 0) {
      setHint('Inserisci prima l’importo');
      return;
    }
    if (category.id === CATEGORY_IDS.rimborsi) {
      setCategoryId(category.id);
      setPickingExpense(true);
      return;
    }
    void save({ categoryId: category.id });
  }

  const linkedExpense = reimbursesId ? transactions.find((item) => item.id === reimbursesId) : undefined;
  const showLinkRow = Boolean(editing) && type === 'entrata' && categoryId === CATEGORY_IDS.rimborsi;
  const showSaveButton = Boolean(editing) || type === 'trasferimento';

  return (
    <Sheet title={editing ? 'Modifica movimento' : 'Nuovo movimento'} onClose={closeEntry} tall bare>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-page pb-safe">
        <Segmented options={TYPE_OPTIONS} value={type} onChange={changeType} />

        <div className="text-center">
          <p
            className={`text-4xl font-semibold tabular-nums ${type === 'entrata' ? 'text-positive' : ''} ${
              input === '' ? 'opacity-40' : ''
            }`}
          >
            {formatKeypadInput(input)}&nbsp;€
          </p>
          <p role="alert" className="min-h-5 text-sm text-danger">
            {hint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {type === 'trasferimento' ? (
            <>
              <SelectChip
                label={`Da: ${accountName(accountId)}`}
                ariaLabel="Conto di partenza"
                value={accountId}
                onChange={changeFrom}
                options={accountOptions}
              />
              <SelectChip
                label={`A: ${accountName(toAccountId)}`}
                ariaLabel="Conto di destinazione"
                value={toAccountId}
                onChange={setToAccountId}
                options={accountOptions}
              />
            </>
          ) : (
            <SelectChip
              label={accountName(accountId)}
              ariaLabel="Conto"
              value={accountId}
              onChange={setAccountId}
              options={accountOptions}
            />
          )}
          <DateChip label={formatShortDate(date, today)} ariaLabel="Data" value={date} onChange={setDate} />
          <button
            type="button"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((value) => !value)}
            className={`min-h-10 rounded-full border px-3 text-sm ${
              note || tagsText ? 'border-accent text-accent' : 'border-line'
            }`}
          >
            Nota
          </button>
        </div>

        {showDetails && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Nota">
              <TextInput
                value={note}
                onChange={(event) => setNote(event.target.value)}
                enterKeyHint="done"
                onKeyDown={blurOnEnter}
              />
            </Field>
            <Field label="Tag, con virgole">
              <TextInput
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                enterKeyHint="done"
                onKeyDown={blurOnEnter}
              />
            </Field>
          </div>
        )}

        {showLinkRow && (
          <button
            type="button"
            onClick={() => setPickingExpense(true)}
            className="min-h-10 truncate rounded-xl border border-line px-3 text-left text-sm"
          >
            {linkedExpense
              ? `Rimborso di: ${linkedExpense.note || 'spesa'} (${formatCents(linkedExpense.amountCents)})`
              : 'Collega a una spesa'}
          </button>
        )}

        <div className="min-h-20 flex-1 overflow-y-auto overscroll-contain">
          {type === 'trasferimento' ? (
            selectableAccounts.length < 2 && (
              <p className="py-4 text-center text-sm text-muted">Per un trasferimento servono almeno due conti.</p>
            )
          ) : (
            <div className="grid grid-cols-4 gap-1.5">
              {tiles.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => pressCategory(category)}
                  style={{ backgroundColor: `${category.color}1f` }}
                  className={`flex h-[4.5rem] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 active:opacity-70 ${
                    category.id === categoryId ? 'ring-2 ring-accent ring-inset' : ''
                  }`}
                >
                  <span className="text-2xl leading-none" aria-hidden="true">
                    {category.emoji}
                  </span>
                  <span className="line-clamp-2 text-center text-[11px] leading-tight">{category.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {showSaveButton && (
          <Button onClick={() => void save({ reimbursesId })}>
            {editing ? 'Salva modifiche' : 'Salva trasferimento'}
          </Button>
        )}

        <Keypad
          onKey={(key) => {
            setHint('');
            setInput((current) => applyKeypadKey(current, key));
          }}
        />
      </div>

      {pickingExpense && (
        <ExpensePicker
          skipLabel={editing ? 'Nessun collegamento' : 'Salva senza collegarlo'}
          onClose={() => setPickingExpense(false)}
          onSkip={() => {
            setPickingExpense(false);
            if (editing) setReimbursesId(undefined);
            else void save({ categoryId: CATEGORY_IDS.rimborsi });
          }}
          onPick={(expenseId) => {
            setPickingExpense(false);
            if (editing) setReimbursesId(expenseId);
            else void save({ categoryId: CATEGORY_IDS.rimborsi, reimbursesId: expenseId });
          }}
        />
      )}
    </Sheet>
  );
}
