import { useState } from 'react';
import { useData } from '../../db/DataProvider';
import { createRecurring, deleteRecurring, updateRecurring, type RecurringDraft } from '../../db/recurring';
import { formatShortDate, todayIso } from '../../domain/dates';
import { describeFrequency, templateAmountText } from '../../domain/recurring';
import { RECURRING_UNITS, type Recurring, type RecurringRule, type RecurringUnit } from '../../domain/types';
import { routeHref } from '../../router';
import { AmountField } from '../../ui/AmountField';
import { Button, ButtonRow, Field, ListGroup, Segmented, SelectInput, TextInput, ToggleRow } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

const TYPE_OPTIONS = [
  { value: 'uscita', label: 'Uscita' },
  { value: 'entrata', label: 'Entrata' },
  { value: 'trasferimento', label: 'Trasferimento' },
] as const;
type RecurringType = (typeof TYPE_OPTIONS)[number]['value'];

const FREQUENCY_OPTIONS = [
  { value: 'mensile', label: 'Ogni mese' },
  { value: 'annuale', label: 'Ogni anno' },
  { value: 'personalizzata', label: 'Personalizzata' },
] as const;

const UNIT_OPTIONS = RECURRING_UNITS.map((unit) => ({ value: unit, label: unit }));

function RecurringForm({ recurring, onClose }: { recurring: Recurring | null; onClose: () => void }) {
  const { accounts, categories } = useData();
  const template = recurring?.template;

  const selectable = accounts.filter(
    (account) => !account.archived || account.id === template?.accountId || account.id === template?.toAccountId,
  );
  const preferred = selectable.find((account) => account.type === 'corrente') ?? selectable[0];

  const [name, setName] = useState(recurring?.name ?? '');
  const [type, setType] = useState<RecurringType>(
    template && template.type !== 'rettifica' ? template.type : 'uscita',
  );
  const [cents, setCents] = useState(template?.amountCents ?? 0);
  const [accountId, setAccountId] = useState(template?.accountId ?? preferred?.id ?? '');
  const [toAccountId, setToAccountId] = useState(
    template?.toAccountId ?? selectable.find((account) => account.id !== preferred?.id)?.id ?? '',
  );
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? '');
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>(recurring?.frequency ?? 'mensile');
  const [intervalText, setIntervalText] = useState(String(recurring?.interval ?? 1));
  const [unit, setUnit] = useState<RecurringUnit>(recurring?.intervalUnit ?? 'settimane');
  const [anchorDate, setAnchorDate] = useState(recurring?.anchorDate ?? todayIso());
  const [active, setActive] = useState(recurring?.active ?? true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const accountOptions = selectable.map((account) => ({ value: account.id, label: account.name }));
  const categoryOptions = [
    { value: '', label: 'Scegli una categoria' },
    ...categories
      .filter((category) => category.kind === type && (!category.archived || category.id === template?.categoryId))
      .map((category) => ({ value: category.id, label: `${category.emoji} ${category.name}` })),
  ];

  function changeType(next: RecurringType) {
    setType(next);
    setCategoryId('');
    setError('');
  }

  async function save() {
    const draft: RecurringDraft = {
      name,
      frequency,
      anchorDate,
      active,
      template:
        type === 'trasferimento'
          ? { type, amountCents: cents, accountId, toAccountId }
          : { type, amountCents: cents, accountId, categoryId: categoryId || undefined },
    };
    if (frequency === 'personalizzata') {
      draft.interval = Number(intervalText);
      draft.intervalUnit = unit;
    }
    try {
      if (recurring) await updateRecurring(recurring.id, draft);
      else await createRecurring(draft);
      notify(recurring ? 'Ricorrenza aggiornata' : 'Ricorrenza creata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!recurring) return;
    await deleteRecurring(recurring.id);
    notify('Ricorrenza eliminata');
    onClose();
  }

  return (
    <Sheet title={recurring ? 'Modifica ricorrenza' : 'Nuova ricorrenza'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        <Segmented options={TYPE_OPTIONS} value={type} onChange={changeType} />
        <Field label="Importo">
          <AmountField title="Importo" cents={cents} onChange={setCents} />
        </Field>
        <Field label={type === 'trasferimento' ? 'Dal conto' : 'Conto'}>
          <SelectInput value={accountId} onChange={setAccountId} options={accountOptions} />
        </Field>
        {type === 'trasferimento' ? (
          <Field label="Al conto">
            <SelectInput value={toAccountId} onChange={setToAccountId} options={accountOptions} />
          </Field>
        ) : (
          <Field label="Categoria">
            <SelectInput value={categoryId} onChange={setCategoryId} options={categoryOptions} />
          </Field>
        )}
        <Field label="Frequenza">
          <SelectInput
            value={frequency}
            onChange={(value) => setFrequency(value as RecurringRule['frequency'])}
            options={FREQUENCY_OPTIONS}
          />
        </Field>
        {frequency === 'personalizzata' && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ogni">
              <TextInput
                value={intervalText}
                onChange={(event) => setIntervalText(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </Field>
            <Field label="Unità">
              <SelectInput value={unit} onChange={(value) => setUnit(value as RecurringUnit)} options={UNIT_OPTIONS} />
            </Field>
          </div>
        )}
        <Field label="Prima scadenza" hint="Le scadenze passate ti verranno proposte una alla volta.">
          <TextInput
            type="date"
            value={anchorDate}
            onChange={(event) => {
              if (event.target.value) setAnchorDate(event.target.value);
            }}
          />
        </Field>
        {recurring && (
          <ToggleRow
            label="Attiva"
            hint="Se la spegni, non ti propone più movimenti."
            checked={active}
            onChange={setActive}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {recurring ? 'Salva' : 'Crea ricorrenza'}
        </Button>
        {recurring &&
          (confirmingDelete ? (
            <Button variant="danger" className="w-full" onClick={() => void remove()}>
              Conferma eliminazione
            </Button>
          ) : (
            <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmingDelete(true)}>
              Elimina ricorrenza
            </Button>
          ))}
        {recurring && <p className="text-center text-xs text-muted">I movimenti già confermati restano.</p>}
      </div>
    </Sheet>
  );
}

export function Ricorrenze() {
  const { accounts, recurring } = useData();
  const [editing, setEditing] = useState<Recurring | 'new' | null>(null);
  const today = todayIso();
  const hasAccounts = accounts.some((account) => !account.archived);
  const sorted = [...recurring].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.nextDue.localeCompare(b.nextDue),
  );

  return (
    <Screen title="Ricorrenze" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      {sorted.length === 0 ? (
        <p className="pb-4 text-center text-muted">
          Stipendio, affitto, abbonamenti, PAC: alla scadenza te li propone in Home e li crea solo quando confermi.
        </p>
      ) : (
        <ListGroup>
          {sorted.map((item) => (
            <ButtonRow key={item.id} onClick={() => setEditing(item)} detail={templateAmountText(item.template)}>
              <span className="block truncate">{item.name}</span>
              <span className="block truncate text-xs text-muted">
                {describeFrequency(item)} ·{' '}
                {item.active ? `prossima ${formatShortDate(item.nextDue, today).toLowerCase()}` : 'sospesa'}
              </span>
            </ButtonRow>
          ))}
        </ListGroup>
      )}
      <Button className="mt-4 w-full" disabled={!hasAccounts} onClick={() => setEditing('new')}>
        Nuova ricorrenza
      </Button>
      {!hasAccounts && <p className="pt-2 text-center text-xs text-muted">Prima crea un conto.</p>}
      {editing && <RecurringForm recurring={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}
