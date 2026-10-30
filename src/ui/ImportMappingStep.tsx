import { useMemo } from 'react';
import { useData } from '../db/DataProvider';
import { formatFullDate } from '../domain/dates';
import { formatCents } from '../domain/money';
import type { StatementSheet } from '../domain/statementFile';
import {
  describeColumns,
  distinctValues,
  extractRows,
  findHeaderRow,
  guessIncomeValue,
  guessMapping,
  mappingProblem,
  type ColumnChoice,
} from '../domain/statementMapping';
import type { AmountMapping, DateOrder, ImportMapping } from '../domain/types';
import { Button, Field, SectionTitle, Segmented, SelectInput, TextInput, ToggleRow } from './controls';

const HEADER_CHOICES = 30;
const SAMPLE_ROWS = 3;

const MODE_OPTIONS = [
  { value: 'segno', label: 'Una colonna' },
  { value: 'due-colonne', label: 'Entrate e uscite' },
  { value: 'tipo', label: 'Con il tipo' },
] as const;

const ORDER_OPTIONS = [
  { value: 'gma', label: 'Giorno/mese' },
  { value: 'mga', label: 'Mese/giorno' },
] as const;

/** Quello che si sta decidendo per questo file: finché non si conferma l'import non si salva niente. */
export interface ImportDraft {
  fileName: string;
  sheets: StatementSheet[];
  sheetIndex: number;
  mapping: ImportMapping;
  profileId?: string;
  bankName: string;
  accountId: string;
}

function ColumnField({
  label,
  value,
  onChange,
  columns,
  emptyLabel = 'Scegli una colonna',
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  columns: ColumnChoice[];
  emptyLabel?: string;
}) {
  return (
    <Field label={label}>
      <SelectInput
        value={value === null ? '' : String(value)}
        onChange={(next) => onChange(next === '' ? null : Number(next))}
        options={[{ value: '', label: emptyLabel }, ...columns]}
      />
    </Field>
  );
}

export function ImportMappingStep({
  draft,
  onChange,
  onContinue,
}: {
  draft: ImportDraft;
  onChange: (draft: ImportDraft) => void;
  onContinue: () => void;
}) {
  const { accounts, importProfiles } = useData();
  const rows = draft.sheets[draft.sheetIndex]?.rows ?? [];
  const { mapping } = draft;
  const { amount, headerRow } = mapping;

  const columns = useMemo(() => describeColumns(rows, headerRow), [rows, headerRow]);
  const reading = useMemo(() => extractRows(rows, mapping), [rows, mapping]);
  const problem = mappingProblem(mapping);
  const accountOptions = accounts.filter((account) => !account.archived).map((account) => ({ value: account.id, label: account.name }));
  const accountName = accounts.find((account) => account.id === draft.accountId)?.name ?? '';

  const headerOptions = [
    { value: 'nessuna', label: 'Nessuna intestazione' },
    ...rows.slice(0, HEADER_CHOICES).map((row, index) => ({
      value: String(index),
      label: `Riga ${index + 1}: ${row.filter(Boolean).join(' · ').slice(0, 48)}`,
    })),
  ];
  const dateValues = distinctValues(rows, headerRow, mapping.dateColumn);
  const orderMatters = dateValues.some((value) => /^\d{1,2}[-/.]\d{1,2}[-/.]/.test(value));
  const typeValues = amount.mode === 'tipo' ? distinctValues(rows, headerRow, amount.typeColumn) : [];

  function setMapping(fields: Partial<ImportMapping>) {
    onChange({ ...draft, mapping: { ...mapping, ...fields } });
  }

  function setAmount(next: AmountMapping) {
    setMapping({ amount: next });
  }

  function switchMode(mode: AmountMapping['mode']) {
    const column = amount.mode === 'due-colonne' ? null : amount.column;
    if (mode === 'segno') setAmount({ mode, column, invert: false });
    else if (mode === 'due-colonne') setAmount({ mode, incomeColumn: null, expenseColumn: null });
    else setAmount({ mode, column, typeColumn: null, incomeValue: '' });
  }

  function chooseHeader(value: string) {
    setMapping(guessMapping(rows, value === 'nessuna' ? null : Number(value)));
  }

  function chooseSheet(value: string) {
    const sheetIndex = Number(value);
    const sheetRows = draft.sheets[sheetIndex]?.rows ?? [];
    onChange({ ...draft, sheetIndex, mapping: guessMapping(sheetRows, findHeaderRow(sheetRows)) });
  }

  function chooseProfile(id: string) {
    const profile = importProfiles.find((item) => item.id === id);
    if (!profile) {
      onChange({ ...draft, profileId: undefined });
      return;
    }
    onChange({
      ...draft,
      profileId: profile.id,
      bankName: profile.name,
      mapping: profile.mapping,
      accountId: accountOptions.some(({ value }) => value === profile.accountId) ? (profile.accountId ?? '') : draft.accountId,
    });
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-muted">
        Controlla quale colonna contiene cosa in <span className="font-medium text-ink">{draft.fileName}</span>. Lo farai una volta sola per ogni banca.
      </p>

      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <Field label="Conto su cui importare">
          <SelectInput value={draft.accountId} onChange={(accountId) => onChange({ ...draft, accountId })} options={accountOptions} />
        </Field>
        {importProfiles.length > 0 && (
          <Field label="Usa una banca salvata">
            <SelectInput
              value={draft.profileId ?? ''}
              onChange={chooseProfile}
              options={[{ value: '', label: 'Nessuna, è una banca nuova' }, ...importProfiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
            />
          </Field>
        )}
        {draft.sheets.length > 1 && (
          <Field label="Foglio">
            <SelectInput
              value={String(draft.sheetIndex)}
              onChange={chooseSheet}
              options={draft.sheets.map((sheet, index) => ({ value: String(index), label: sheet.name }))}
            />
          </Field>
        )}
        <Field label="Riga con le intestazioni">
          <SelectInput value={headerRow === null ? 'nessuna' : String(headerRow)} onChange={chooseHeader} options={headerOptions} />
        </Field>
      </div>

      <SectionTitle>Colonne</SectionTitle>
      <div className="space-y-3 rounded-2xl bg-surface p-4">
        <ColumnField label="Data" value={mapping.dateColumn} onChange={(dateColumn) => setMapping({ dateColumn })} columns={columns} />
        {orderMatters && (
          <Segmented<DateOrder> options={ORDER_OPTIONS} value={mapping.dateOrder} onChange={(dateOrder) => setMapping({ dateOrder })} />
        )}
        <ColumnField
          label="Descrizione"
          value={mapping.descriptionColumn}
          onChange={(descriptionColumn) => setMapping({ descriptionColumn })}
          columns={columns}
        />
        <ColumnField
          label="Altra descrizione (facoltativa)"
          value={mapping.detailsColumn}
          onChange={(detailsColumn) => setMapping({ detailsColumn })}
          columns={columns}
          emptyLabel="Nessuna"
        />

        <div>
          <span className="mb-1 block text-sm font-medium text-muted">Importo</span>
          <Segmented options={MODE_OPTIONS} value={amount.mode} onChange={switchMode} fitLabels />
        </div>
        {amount.mode === 'segno' && (
          <>
            <ColumnField label="Colonna dell’importo" value={amount.column} onChange={(column) => setAmount({ ...amount, column })} columns={columns} />
            <ToggleRow
              label="Inverti il segno"
              hint="Se nel file le spese sono numeri positivi, come negli estratti delle carte."
              checked={amount.invert}
              onChange={(invert) => setAmount({ ...amount, invert })}
            />
          </>
        )}
        {amount.mode === 'due-colonne' && (
          <>
            <ColumnField
              label="Entrate (o Avere)"
              value={amount.incomeColumn}
              onChange={(incomeColumn) => setAmount({ ...amount, incomeColumn })}
              columns={columns}
            />
            <ColumnField
              label="Uscite (o Dare)"
              value={amount.expenseColumn}
              onChange={(expenseColumn) => setAmount({ ...amount, expenseColumn })}
              columns={columns}
            />
          </>
        )}
        {amount.mode === 'tipo' && (
          <>
            <ColumnField label="Colonna dell’importo" value={amount.column} onChange={(column) => setAmount({ ...amount, column })} columns={columns} />
            <ColumnField
              label="Colonna con il tipo (Dare/Avere, +/−…)"
              value={amount.typeColumn}
              onChange={(typeColumn) =>
                setAmount({ ...amount, typeColumn, incomeValue: guessIncomeValue(distinctValues(rows, headerRow, typeColumn)) })
              }
              columns={columns}
            />
            {amount.typeColumn !== null && (
              <Field label="Quale valore indica un’entrata">
                <SelectInput
                  value={amount.incomeValue}
                  onChange={(incomeValue) => setAmount({ ...amount, incomeValue })}
                  options={[{ value: '', label: 'Scegli un valore' }, ...typeValues.map((value) => ({ value, label: value }))]}
                />
              </Field>
            )}
          </>
        )}
      </div>

      <SectionTitle>Come lo sto leggendo</SectionTitle>
      <div className="rounded-2xl bg-surface p-4 text-sm">
        {problem ? (
          <p className="text-muted">{problem}.</p>
        ) : reading.rows.length === 0 ? (
          <p className="text-danger">Con queste colonne non riesco a leggere nessun movimento.</p>
        ) : (
          <>
            <p className="font-medium">
              {reading.rows.length === 1 ? '1 movimento' : `${reading.rows.length} movimenti`}
              {reading.skipped.length > 0 && (
                <span className="font-normal text-muted">
                  {' · '}
                  {reading.skipped.length === 1 ? '1 riga non letta' : `${reading.skipped.length} righe non lette`}
                </span>
              )}
            </p>
            <ul className="mt-2 divide-y divide-line">
              {reading.rows.slice(0, SAMPLE_ROWS).map((row, index) => (
                <li key={index} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate">{row.description || 'Senza descrizione'}</span>
                    <span className="block text-xs text-muted">{formatFullDate(row.date)}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${row.amountCents > 0 ? 'text-positive' : ''}`}>{formatCents(row.amountCents)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <Field label="Nome della banca" hint="La mappatura resta salvata: il prossimo file di questa banca viene riconosciuto da solo.">
        <TextInput
          value={draft.bankName}
          onChange={(event) => onChange({ ...draft, bankName: event.target.value })}
          placeholder={accountName}
          autoComplete="off"
        />
      </Field>

      <Button className="w-full" disabled={Boolean(problem) || reading.rows.length === 0 || !draft.accountId} onClick={onContinue}>
        Continua
      </Button>
    </div>
  );
}
