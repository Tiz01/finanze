import { useState } from 'react';
import { useData } from '../../db/DataProvider';
import { createRule, deleteRule, updateRule } from '../../db/imports';
import type { ImportRule } from '../../domain/types';
import { routeHref } from '../../router';
import { Button, ButtonRow, Field, ListGroup, Segmented, SelectInput, TextInput } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

const TARGET_OPTIONS = [
  { value: 'categoria', label: 'Categoria' },
  { value: 'trasferimento', label: 'Trasferimento' },
] as const;

function RuleForm({ rule, onClose }: { rule: ImportRule | null; onClose: () => void }) {
  const { accounts, categories } = useData();
  const [contains, setContains] = useState(rule?.contains ?? '');
  const [target, setTarget] = useState<'categoria' | 'trasferimento'>(rule?.transferAccountId ? 'trasferimento' : 'categoria');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const [accountId, setAccountId] = useState(rule?.transferAccountId ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const categoryOptions = categories
    .filter((category) => category.kind !== 'rettifica' && (!category.archived || category.id === categoryId))
    .map((category) => ({ value: category.id, label: `${category.emoji} ${category.name}` }));
  const accountOptions = accounts
    .filter((account) => !account.archived || account.id === accountId)
    .map((account) => ({ value: account.id, label: account.name }));

  async function save() {
    if (target === 'trasferimento' && !accountId) {
      setError('Scegli il conto');
      return;
    }
    const draft = target === 'trasferimento' ? { contains, transferAccountId: accountId } : { contains, categoryId };
    try {
      if (rule) await updateRule(rule.id, draft);
      else await createRule(draft);
      notify(rule ? 'Regola aggiornata' : 'Regola creata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!rule) return;
    await deleteRule(rule.id);
    notify('Regola eliminata');
    onClose();
  }

  return (
    <Sheet title={rule ? 'Modifica regola' : 'Nuova regola'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Se la descrizione contiene" hint="Non importa se è maiuscolo o minuscolo.">
          <TextInput value={contains} onChange={(event) => setContains(event.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="Es. SUPERMERCATO" />
        </Field>
        <Field label="Allora è">
          <Segmented options={TARGET_OPTIONS} value={target} onChange={setTarget} />
        </Field>
        {target === 'categoria' ? (
          <Field label="Usa la categoria">
            <SelectInput value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Scegli una categoria' }, ...categoryOptions]} />
          </Field>
        ) : (
          <>
            <Field label="Con il conto">
              <SelectInput value={accountId} onChange={setAccountId} options={[{ value: '', label: 'Scegli un conto' }, ...accountOptions]} />
            </Field>
            <p className="text-sm text-muted">
              Se i soldi escono è un trasferimento verso questo conto, se entrano arrivano da questo conto. Non conta né come spesa né come entrata.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {rule ? 'Salva' : 'Crea regola'}
        </Button>
        {rule &&
          (confirmingDelete ? (
            <Button variant="danger" className="w-full" onClick={() => void remove()}>
              Conferma eliminazione
            </Button>
          ) : (
            <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmingDelete(true)}>
              Elimina regola
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

export function Regole() {
  const { accounts, categories, importRules } = useData();
  const [editing, setEditing] = useState<ImportRule | 'new' | null>(null);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const sorted = [...importRules].sort((a, b) => a.contains.localeCompare(b.contains, 'it'));

  // Una regola su un conto o una categoria archiviati non scatta: va detto, altrimenti sembra rotta.
  function describe(rule: ImportRule): string {
    if (rule.transferAccountId) {
      const account = accountsById.get(rule.transferAccountId);
      return `⇄ Trasferimento con ${account?.name ?? 'un conto eliminato'}${account?.archived ? ' · archiviato, non si applica' : ''}`;
    }
    const category = categoriesById.get(rule.categoryId ?? '');
    if (!category) return 'Categoria eliminata';
    return `${category.emoji} ${category.name}${category.archived ? ' · archiviata, non si applica' : ''}`;
  }

  return (
    <Screen title="Regole di import" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      {sorted.length === 0 ? (
        <p className="pb-4 text-center text-muted">
          Una regola decide cosa diventano i movimenti importati: se la descrizione contiene un testo, assegna una categoria oppure li segna come trasferimento con un altro conto.
        </p>
      ) : (
        <>
          <ListGroup>
            {sorted.map((rule) => (
              <ButtonRow key={rule.id} onClick={() => setEditing(rule)}>
                <span className="block truncate">{rule.contains}</span>
                <span className="block truncate text-xs text-muted">{describe(rule)}</span>
              </ButtonRow>
            ))}
          </ListGroup>
          <p className="px-1 pt-2 text-xs text-muted">Se più regole valgono per la stessa riga, vince quella con il testo più lungo.</p>
        </>
      )}
      <Button className="mt-4 w-full" onClick={() => setEditing('new')}>
        Nuova regola
      </Button>
      {editing && <RuleForm rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}
