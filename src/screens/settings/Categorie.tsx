import { useMemo, useState } from 'react';
import { createCategory, deleteCategory, updateCategory } from '../../db/categories';
import { useData } from '../../db/DataProvider';
import { CATEGORY_COLORS, firstGrapheme } from '../../domain/categories';
import type { Category } from '../../domain/types';
import { routeHref } from '../../router';
import { Button, ButtonRow, Field, ListGroup, SectionTitle, Segmented, TextInput, ToggleRow } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

type EditableKind = 'uscita' | 'entrata';

const KIND_OPTIONS = [
  { value: 'uscita', label: 'Uscita' },
  { value: 'entrata', label: 'Entrata' },
] as const;

function CategoryForm({
  category,
  groups,
  usageCount,
  onClose,
}: {
  category: Category | null;
  groups: string[];
  usageCount: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [emoji, setEmoji] = useState(category?.emoji ?? '');
  const [color, setColor] = useState<string>(category?.color ?? CATEGORY_COLORS[0]);
  const [group, setGroup] = useState(category?.group ?? '');
  const [kind, setKind] = useState<EditableKind>(category?.kind === 'entrata' ? 'entrata' : 'uscita');
  const [fissa, setFissa] = useState(category?.fissa ?? false);
  const [archived, setArchived] = useState(category?.archived ?? false);
  const [error, setError] = useState('');

  async function save() {
    const draft = { name, emoji, color, group, kind, fissa: kind === 'uscita' && fissa, archived };
    try {
      if (category) await updateCategory(category.id, draft);
      else await createCategory(draft);
      notify(category ? 'Categoria aggiornata' : 'Categoria creata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!category) return;
    try {
      await deleteCategory(category.id);
      notify('Categoria eliminata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile eliminare');
    }
  }

  return (
    <Sheet title={category ? 'Modifica categoria' : 'Nuova categoria'} onClose={onClose}>
      <div className="space-y-3">
        {!category && <Segmented options={KIND_OPTIONS} value={kind} onChange={setKind} />}
        <div className="grid grid-cols-[1fr_4.5rem] gap-2">
          <Field label="Nome">
            <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="Emoji">
            <TextInput
              value={emoji}
              onChange={(event) => setEmoji(firstGrapheme(event.target.value))}
              className="text-center"
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Macro-categoria">
          <TextInput
            value={group}
            onChange={(event) => setGroup(event.target.value)}
            list="category-groups"
            autoComplete="off"
          />
          <datalist id="category-groups">
            {groups.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </Field>
        <div>
          <span className="mb-1 block text-sm font-medium text-muted">Colore</span>
          <div role="radiogroup" aria-label="Colore" className="grid grid-cols-6 gap-2">
            {CATEGORY_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={option === color}
                aria-label={option}
                onClick={() => setColor(option)}
                style={{ backgroundColor: option }}
                className={`h-11 rounded-xl ${option === color ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
              />
            ))}
          </div>
        </div>
        {kind === 'uscita' && (
          <ToggleRow
            label="Spesa fissa"
            hint="Nei report distingue le spese fisse da quelle variabili."
            checked={fissa}
            onChange={setFissa}
          />
        )}
        {category && (
          <ToggleRow
            label="Archiviata"
            hint="Non si può più scegliere per i nuovi movimenti."
            checked={archived}
            onChange={setArchived}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {category ? 'Salva' : 'Crea categoria'}
        </Button>
        {category &&
          (category.system ? (
            <p className="text-center text-xs text-muted">Serve ai report: puoi rinominarla ma non eliminarla.</p>
          ) : usageCount > 0 ? (
            <p className="text-center text-xs text-muted">
              Ha {usageCount} {usageCount === 1 ? 'movimento' : 'movimenti'}: per toglierla dall’uso puoi archiviarla.
            </p>
          ) : (
            <Button variant="dangerOutline" className="w-full" onClick={() => void remove()}>
              Elimina categoria
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

function CategoryRow({ category, onPress }: { category: Category; onPress: () => void }) {
  const notes = [category.fissa ? 'fissa' : '', category.archived ? 'archiviata' : ''].filter(Boolean).join(' · ');
  return (
    <ButtonRow onClick={onPress}>
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          style={{ backgroundColor: `${category.color}1f` }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-lg"
        >
          {category.emoji}
        </span>
        <span className="min-w-0">
          <span className="block truncate">{category.name}</span>
          {notes && <span className="block truncate text-xs text-muted">{notes}</span>}
        </span>
      </span>
    </ButtonRow>
  );
}

export function Categorie() {
  const { categories, transactions } = useData();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { categoryId } of transactions) {
      if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }
    return counts;
  }, [transactions]);

  const editable = categories.filter((category) => category.kind !== 'rettifica');
  const groups = [...new Set(editable.map((category) => category.group).filter(Boolean))];

  const section = (kind: EditableKind) => {
    const items = editable.filter((category) => category.kind === kind);
    const kindGroups = [...new Set(items.map((category) => category.group))];
    return kindGroups.map((group) => (
      <div key={`${kind}-${group}`}>
        <SectionTitle>{group || 'Senza macro-categoria'}</SectionTitle>
        <ListGroup>
          {items
            .filter((category) => category.group === group)
            .map((category) => (
              <CategoryRow key={category.id} category={category} onPress={() => setEditing(category)} />
            ))}
        </ListGroup>
      </div>
    ));
  };

  return (
    <Screen title="Categorie" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      <Button className="mb-2 w-full" onClick={() => setEditing('new')}>
        Nuova categoria
      </Button>
      {section('uscita')}
      {section('entrata')}
      {editing && (
        <CategoryForm
          category={editing === 'new' ? null : editing}
          groups={groups}
          usageCount={editing === 'new' ? 0 : (usage.get(editing.id) ?? 0)}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  );
}
