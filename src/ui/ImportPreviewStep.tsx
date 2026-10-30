import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { createRule, type RuleDraft } from '../db/imports';
import { formatShortDate, todayIso } from '../domain/dates';
import { applyRules, summarizePreview, type PreviewRow } from '../domain/importPreview';
import { suggestRuleText } from '../domain/importRules';
import { formatCents, formatSignedCents } from '../domain/money';
import type { SkippedRow } from '../domain/statementMapping';
import type { Category } from '../domain/types';
import { Button, Field, ListGroup, Segmented, SelectInput, TextInput, ToggleRow } from './controls';
import { notifyError } from './feedback';
import { Sheet } from './Sheet';
import { StatGrid, StatTile } from './stats';

const PAGE_SIZE = 100;

type Filter = 'importa' | 'escluse' | 'non-lette';

/** Le categorie per il selettore, con l'emoji davanti. */
function categoryOptions(categories: Category[], kind: 'entrata' | 'uscita', current?: string) {
  return categories
    .filter((category) => category.kind === kind && (!category.archived || category.id === current))
    .map((category) => ({ value: category.id, label: `${category.emoji} ${category.name}` }));
}

function RowEditor({
  row,
  accountId,
  onSave,
  onClose,
}: {
  row: PreviewRow;
  accountId: string;
  onSave: (row: PreviewRow, newRule?: RuleDraft) => Promise<void>;
  onClose: () => void;
}) {
  const { accounts, categories } = useData();
  const kind = row.amountCents < 0 ? 'uscita' : 'entrata';
  const [include, setInclude] = useState(row.include);
  const [type, setType] = useState(row.type);
  const [categoryId, setCategoryId] = useState(row.categoryId ?? '');
  const [otherAccountId, setOtherAccountId] = useState(row.otherAccountId ?? '');
  const [makeRule, setMakeRule] = useState(false);
  const [contains, setContains] = useState(() => suggestRuleText(row.description));
  const [error, setError] = useState('');

  const others = accounts.filter((account) => !account.archived && account.id !== accountId);
  const typeOptions: { value: PreviewRow['type']; label: string }[] = [
    { value: kind, label: kind === 'uscita' ? 'Uscita' : 'Entrata' },
    ...(others.length > 0 ? [{ value: 'trasferimento' as const, label: 'Trasferimento' }] : []),
  ];

  async function save() {
    if (type === 'trasferimento' && !otherAccountId) {
      setError('Scegli l’altro conto');
      return;
    }
    if (type !== 'trasferimento' && !categoryId) {
      setError('Scegli la categoria');
      return;
    }
    const edited: PreviewRow = {
      ...row,
      include,
      type,
      categoryId: type === 'trasferimento' ? undefined : categoryId,
      otherAccountId: type === 'trasferimento' ? otherAccountId : undefined,
      edited: true,
    };
    const target = type === 'trasferimento' ? { transferAccountId: otherAccountId } : { categoryId };
    try {
      await onSave(edited, makeRule ? { contains, ...target } : undefined);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title="Movimento" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <p className="text-sm break-words">{row.description || 'Senza descrizione'}</p>
          <p className={`pt-1 font-semibold tabular-nums ${row.amountCents > 0 ? 'text-positive' : ''}`}>
            {formatCents(row.amountCents)}
            <span className="font-normal text-muted"> · {formatShortDate(row.date, todayIso())}</span>
          </p>
          {row.status === 'forse-presente' && row.match && (
            <p className="pt-1 text-sm text-muted">
              Forse è già inserito: {row.match.note || 'un movimento'} del {formatShortDate(row.match.date, todayIso())}, stesso importo.
            </p>
          )}
        </div>
        <ToggleRow label="Importa questo movimento" checked={include} onChange={setInclude} />
        {typeOptions.length > 1 && <Segmented options={typeOptions} value={type} onChange={setType} />}
        {type === 'trasferimento' ? (
          <>
            <Field label={kind === 'uscita' ? 'Verso quale conto' : 'Da quale conto'}>
              <SelectInput
                value={otherAccountId}
                onChange={setOtherAccountId}
                options={[{ value: '', label: 'Scegli un conto' }, ...others.map((account) => ({ value: account.id, label: account.name }))]}
              />
            </Field>
            <p className="text-sm text-muted">Un trasferimento non è né una spesa né un’entrata.</p>
          </>
        ) : (
          <Field label="Categoria">
            <SelectInput value={categoryId} onChange={setCategoryId} options={categoryOptions(categories, kind, categoryId)} />
          </Field>
        )}
        <ToggleRow label="Crea una regola" hint="Vale per questo file e per i prossimi." checked={makeRule} onChange={setMakeRule} />
        {makeRule && (
          <Field label="Se la descrizione contiene">
            <TextInput value={contains} onChange={(event) => setContains(event.target.value)} autoComplete="off" autoCapitalize="characters" />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Salva
        </Button>
      </div>
    </Sheet>
  );
}

function Row({ row, onPress }: { row: PreviewRow; onPress: () => void }) {
  const { accounts, categories } = useData();
  const category = categories.find(({ id }) => id === row.categoryId);
  const otherName = accounts.find(({ id }) => id === row.otherAccountId)?.name ?? '';
  const today = todayIso();

  let detail: string;
  if (row.status === 'gia-importato') detail = 'Già importato';
  else if (row.status === 'forse-presente' && !row.edited) detail = `Forse è già: ${row.match?.note || 'un movimento'}, ${formatShortDate(row.match?.date ?? row.date, today)}`;
  else if (row.type === 'trasferimento') detail = `${row.amountCents < 0 ? 'Verso' : 'Da'} ${otherName}`;
  else detail = `${category?.name ?? 'Senza categoria'}${row.fromRule || row.edited ? '' : ' · nessuna regola'}`;

  return (
    <button
      type="button"
      onClick={onPress}
      disabled={row.status === 'gia-importato'}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-bg"
    >
      <span className="w-7 shrink-0 text-center text-xl" aria-hidden="true">
        {row.type === 'trasferimento' ? '⇄' : category?.emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm">{row.description || 'Senza descrizione'}</span>
        <span className="block truncate text-xs text-muted">
          {formatShortDate(row.date, today)} · {detail}
        </span>
      </span>
      <span className={`shrink-0 text-sm tabular-nums ${row.type === 'trasferimento' ? 'text-muted' : row.amountCents > 0 ? 'text-positive' : ''}`}>
        {row.amountCents > 0 ? formatSignedCents(row.amountCents) : formatCents(row.amountCents)}
      </span>
    </button>
  );
}

export function ImportPreviewStep({
  rows,
  skipped,
  accountId,
  bankName,
  onChangeRows,
  onEditMapping,
  onConfirm,
}: {
  rows: PreviewRow[];
  skipped: SkippedRow[];
  accountId: string;
  bankName: string;
  onChangeRows: (rows: PreviewRow[]) => void;
  onEditMapping: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { accounts, categories, importRules } = useData();
  const [filter, setFilter] = useState<Filter>('importa');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const account = accounts.find(({ id }) => id === accountId);
  const summary = useMemo(() => summarizePreview(rows), [rows]);
  const included = rows.filter((row) => row.include);
  const excluded = rows.filter((row) => !row.include);
  const shown = filter === 'importa' ? included : excluded;
  const editing = rows.find((row) => row.key === editingKey);
  const doubtful = excluded.filter((row) => row.status === 'forse-presente').length;
  const beforeStart = account ? included.filter((row) => row.date < account.initialBalanceDate).length : 0;

  const filterOptions: { value: Filter; label: string }[] = [
    { value: 'importa', label: `Da importare (${included.length})` },
    { value: 'escluse', label: `Escluse (${excluded.length})` },
    ...(skipped.length > 0 ? [{ value: 'non-lette' as const, label: `Non lette (${skipped.length})` }] : []),
  ];

  async function saveRow(edited: PreviewRow, newRule?: RuleDraft) {
    let updated = rows.map((row) => (row.key === edited.key ? edited : row));
    if (newRule) {
      const rule = await createRule(newRule);
      updated = applyRules(updated, [...importRules, rule], { accountId, accounts, categories });
    }
    onChangeRows(updated);
  }

  async function confirm() {
    setImporting(true);
    try {
      await onConfirm();
    } catch (error) {
      notifyError(error);
      setImporting(false);
    }
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3 text-sm text-muted">
        <span className="min-w-0 truncate">
          {bankName && bankName !== account?.name ? `${bankName} → ` : ''}
          {account?.name}
        </span>
        <button type="button" onClick={onEditMapping} className="shrink-0 font-medium text-accent">
          Cambia colonne o conto
        </button>
      </div>

      <div className="rounded-2xl bg-surface">
        <StatGrid>
          <StatTile label="Entrate" value={formatSignedCents(summary.incomeCents)} />
          <StatTile label="Uscite" value={formatCents(-summary.expenseCents)} />
        </StatGrid>
        {summary.transfers > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            {summary.transfers === 1 ? '1 trasferimento non conta' : `${summary.transfers} trasferimenti non contano`} né come entrata né come uscita.
          </p>
        )}
      </div>

      {doubtful > 0 && (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm">
          {doubtful === 1
            ? '1 movimento sembra già inserito: stesso conto, stesso importo, data vicina. L’ho escluso; se non è lo stesso riattivalo da '
            : `${doubtful} movimenti sembrano già inseriti: stesso conto, stesso importo, data vicina. Li ho esclusi; se non sono gli stessi riattivali da `}
          <span className="font-medium">Escluse</span>.
        </p>
      )}
      {beforeStart > 0 && (
        <p className="mt-3 rounded-2xl bg-surface px-4 py-3 text-sm">
          {beforeStart === 1 ? '1 movimento è precedente' : `${beforeStart} movimenti sono precedenti`} alla data del saldo iniziale del conto: {beforeStart === 1 ? 'conterà' : 'conteranno'} nei report ma non nel saldo.
        </p>
      )}

      <div className="pt-3 pb-3">
        <Segmented
          options={filterOptions}
          value={filter}
          onChange={(next) => {
            setFilter(next);
            setVisible(PAGE_SIZE);
          }}
          fitLabels
        />
      </div>

      {filter === 'non-lette' ? (
        <ListGroup>
          {skipped.map((row, index) => (
            <div key={index} className="px-4 py-2.5">
              <p className="line-clamp-2 text-sm">{row.text}</p>
              <p className="text-xs text-muted">{row.reason}</p>
            </div>
          ))}
        </ListGroup>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {filter === 'importa' ? 'Niente di nuovo in questo file: sembra già tutto presente.' : 'Nessun movimento escluso.'}
        </p>
      ) : (
        <ListGroup>
          {shown.slice(0, visible).map((row) => (
            <Row key={row.key} row={row} onPress={() => setEditingKey(row.key)} />
          ))}
        </ListGroup>
      )}
      {filter !== 'non-lette' && shown.length > visible && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setVisible((current) => current + PAGE_SIZE)}>
          Mostra altri
        </Button>
      )}

      <div className="sticky -bottom-4 -mb-4 bg-bg pt-3 pb-4">
        <Button className="w-full" disabled={summary.count === 0 || importing} onClick={() => void confirm()}>
          {summary.count === 1 ? 'Importa 1 movimento' : `Importa ${summary.count} movimenti`}
        </Button>
      </div>

      {editing && <RowEditor row={editing} accountId={accountId} onSave={saveRow} onClose={() => setEditingKey(null)} />}
    </>
  );
}
