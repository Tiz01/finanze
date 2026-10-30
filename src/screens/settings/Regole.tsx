import { useState } from 'react';
import { useData } from '../../db/DataProvider';
import { createRule, deleteRule, updateRule } from '../../db/imports';
import type { ImportRule } from '../../domain/types';
import { routeHref } from '../../router';
import { Button, ButtonRow, Field, ListGroup, SelectInput, TextInput } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

function RuleForm({ rule, onClose }: { rule: ImportRule | null; onClose: () => void }) {
  const { categories } = useData();
  const [contains, setContains] = useState(rule?.contains ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const options = categories
    .filter((category) => category.kind !== 'rettifica' && (!category.archived || category.id === categoryId))
    .map((category) => ({ value: category.id, label: `${category.emoji} ${category.name}` }));

  async function save() {
    try {
      if (rule) await updateRule(rule.id, { contains, categoryId });
      else await createRule({ contains, categoryId });
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
        <Field label="Usa la categoria">
          <SelectInput value={categoryId} onChange={setCategoryId} options={[{ value: '', label: 'Scegli una categoria' }, ...options]} />
        </Field>
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
  const { categories, importRules } = useData();
  const [editing, setEditing] = useState<ImportRule | 'new' | null>(null);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const sorted = [...importRules].sort((a, b) => a.contains.localeCompare(b.contains, 'it'));

  return (
    <Screen title="Regole di import" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      {sorted.length === 0 ? (
        <p className="pb-4 text-center text-muted">Una regola assegna la categoria ai movimenti importati: se la descrizione contiene un testo, usa quella categoria.</p>
      ) : (
        <>
          <ListGroup>
            {sorted.map((rule) => {
              const category = byId.get(rule.categoryId);
              return (
                <ButtonRow key={rule.id} onClick={() => setEditing(rule)}>
                  <span className="block truncate">{rule.contains}</span>
                  <span className="block truncate text-xs text-muted">
                    {category ? `${category.emoji} ${category.name}` : 'Categoria eliminata'}
                  </span>
                </ButtonRow>
              );
            })}
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
