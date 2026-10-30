import { useState } from 'react';
import { createBudget, deleteBudget, updateBudget } from '../../db/budgets';
import { useData } from '../../db/DataProvider';
import { formatCents } from '../../domain/money';
import type { Budget } from '../../domain/types';
import { routeHref } from '../../router';
import { AmountField } from '../../ui/AmountField';
import { Button, ButtonRow, Field, ListGroup, Segmented, TextInput } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

const KIND_OPTIONS = [
  { value: 'tetto', label: 'Tetto di spesa' },
  { value: 'obiettivo', label: 'Obiettivo di risparmio' },
] as const;

function BudgetForm({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { accounts, categories } = useData();
  const [name, setName] = useState(budget?.name ?? '');
  const [kind, setKind] = useState<Budget['kind']>(budget?.kind ?? 'tetto');
  const [cents, setCents] = useState(budget?.amountCents ?? 0);
  const [selected, setSelected] = useState<string[]>(budget?.categoryIds ?? []);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const expenseCategories = categories.filter(
    (category) => category.kind === 'uscita' && (!category.archived || selected.includes(category.id)),
  );
  const hasInvestmentAccount = accounts.some((account) => account.type === 'investimento' && !account.archived);

  function toggle(categoryId: string) {
    setSelected((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    );
  }

  async function save() {
    const draft = { name, kind, amountCents: cents, categoryIds: selected };
    try {
      if (budget) await updateBudget(budget.id, draft);
      else await createBudget(draft);
      notify(budget ? 'Busta aggiornata' : 'Busta creata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!budget) return;
    await deleteBudget(budget.id);
    notify('Busta eliminata');
    onClose();
  }

  return (
    <Sheet title={budget ? 'Modifica busta' : 'Nuova busta'} onClose={onClose} tall={kind === 'tetto'}>
      <div className="space-y-3">
        <Field label="Nome">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} fitLabels />
        <Field label={kind === 'tetto' ? 'Limite al mese' : 'Obiettivo al mese'}>
          <AmountField title={kind === 'tetto' ? 'Limite al mese' : 'Obiettivo al mese'} cents={cents} onChange={setCents} />
        </Field>

        {kind === 'obiettivo' ? (
          <p className="text-sm text-muted">
            Si misura su quanto trasferisci verso i conti di tipo Investimento e diventa verde quando lo raggiungi.
            {!hasInvestmentAccount && ' Non hai ancora un conto di questo tipo: puoi crearlo in Impostazioni, Conti.'}
          </p>
        ) : (
          <div>
            <span className="mb-1 block text-sm font-medium text-muted">Categorie che contano ({selected.length})</span>
            <div className="divide-y divide-line overflow-hidden rounded-2xl bg-bg">
              {expenseCategories.map((category) => {
                const checked = selected.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggle(category.id)}
                    className="flex min-h-12 w-full items-center gap-3 px-3 text-left active:bg-line"
                  >
                    <span className="text-xl" aria-hidden="true">
                      {category.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{category.name}</span>
                    <span
                      aria-hidden="true"
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                        checked ? 'border-accent bg-accent text-on-accent' : 'border-muted'
                      }`}
                    >
                      {checked && (
                        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {budget ? 'Salva' : 'Crea busta'}
        </Button>
        {budget &&
          (confirmingDelete ? (
            <Button variant="danger" className="w-full" onClick={() => void remove()}>
              Conferma eliminazione
            </Button>
          ) : (
            <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmingDelete(true)}>
              Elimina busta
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

export function Buste() {
  const { budgets, categories } = useData();
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const names = new Map(categories.map((category) => [category.id, category.name]));

  function describe(budget: Budget): string {
    if (budget.kind === 'obiettivo') return 'Obiettivo sui conti investimento';
    if (budget.categoryIds.length === 0) return 'Nessuna categoria scelta';
    return budget.categoryIds.map((id) => names.get(id) ?? '').join(', ');
  }

  return (
    <Screen title="Buste" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      {budgets.length === 0 ? (
        <p className="pb-4 text-center text-muted">Una busta è un limite mensile su una o più categorie, o un obiettivo di risparmio.</p>
      ) : (
        <ListGroup>
          {budgets.map((budget) => (
            <ButtonRow key={budget.id} onClick={() => setEditing(budget)} detail={formatCents(budget.amountCents)}>
              <span className="block truncate">{budget.name}</span>
              <span className="block truncate text-xs text-muted">{describe(budget)}</span>
            </ButtonRow>
          ))}
        </ListGroup>
      )}
      <Button className="mt-4 w-full" onClick={() => setEditing('new')}>
        Nuova busta
      </Button>
      {editing && <BudgetForm budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}
