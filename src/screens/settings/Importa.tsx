import { useRef, useState, type ChangeEvent } from 'react';
import { useData } from '../../db/DataProvider';
import { deleteProfile, importMovements, renameProfile, saveProfile } from '../../db/imports';
import { buildPreview, previewDrafts, type PreviewRow } from '../../domain/importPreview';
import { readStatementFile } from '../../domain/statementFile';
import { extractRows, findHeaderRow, findProfile, guessMapping, mappingProblem, signatureOf, type SkippedRow } from '../../domain/statementMapping';
import type { ImportProfile } from '../../domain/types';
import { routeHref } from '../../router';
import { Button, ButtonLink, ButtonRow, Field, ListGroup, SectionTitle, TextInput } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { ImportMappingStep, type ImportDraft } from '../../ui/ImportMappingStep';
import { ImportPreviewStep } from '../../ui/ImportPreviewStep';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

const MAX_FILE_BYTES = 30 * 1024 * 1024;

const ACCEPTED_FILES = [
  '.csv',
  '.txt',
  '.tsv',
  '.xlsx',
  '.xls',
  'text/csv',
  'text/plain',
  'text/tab-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

function ProfileEditor({ profile, onClose }: { profile: ImportProfile; onClose: () => void }) {
  const [name, setName] = useState(profile.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    try {
      await renameProfile(profile.id, name);
      notify('Banca aggiornata');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    await deleteProfile(profile.id);
    notify('Banca eliminata');
    onClose();
  }

  return (
    <Sheet title="Banca salvata" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Salva
        </Button>
        {confirmingDelete ? (
          <Button variant="danger" className="w-full" onClick={() => void remove()}>
            Conferma eliminazione
          </Button>
        ) : (
          <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmingDelete(true)}>
            Elimina banca
          </Button>
        )}
        <p className="text-xs text-muted">I movimenti già importati restano. Al prossimo file ti chiederò di nuovo le colonne.</p>
      </div>
    </Sheet>
  );
}

export function Importa() {
  const { accounts, categories, importProfiles, importRules, transactions } = useData();
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; skipped: SkippedRow[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [editingProfile, setEditingProfile] = useState<ImportProfile | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const activeAccounts = accounts.filter((account) => !account.archived);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  function showPreview(next: ImportDraft) {
    const { rows, skipped } = extractRows(next.sheets[next.sheetIndex]?.rows ?? [], next.mapping);
    setPreview({
      rows: buildPreview(rows, { accountId: next.accountId, accounts, transactions, rules: importRules, categories }),
      skipped,
    });
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > MAX_FILE_BYTES) {
      setError('Il file è troppo grande per essere un estratto conto.');
      return;
    }
    setReading(true);
    try {
      const sheets = await readStatementFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (sheets.length === 0) {
        setError('Il file è vuoto.');
        return;
      }
      const base = { fileName: file.name, sheets, sheetIndex: 0, accountId: activeAccounts[0]?.id ?? '' };

      // I movimenti non stanno per forza nel primo foglio.
      const recognized = sheets.findIndex(({ rows }) => findProfile(rows, importProfiles));
      const known = recognized >= 0 ? findProfile(sheets[recognized]?.rows ?? [], importProfiles) : null;
      if (!known) {
        const guesses = sheets.map(({ rows }) => guessMapping(rows, findHeaderRow(rows)));
        const sheetIndex = Math.max(0, guesses.findIndex((mapping) => !mappingProblem(mapping)));
        setDraft({ ...base, sheetIndex, bankName: '', mapping: guesses[sheetIndex] ?? guessMapping([], null) });
        return;
      }
      const { headerRow, profile } = known;
      const next: ImportDraft = {
        ...base,
        sheetIndex: recognized,
        profileId: profile.id,
        bankName: profile.name,
        mapping: { ...profile.mapping, headerRow },
        accountId: activeAccounts.some(({ id }) => id === profile.accountId) ? (profile.accountId ?? '') : base.accountId,
      };
      setDraft(next);
      if (!mappingProblem(next.mapping)) showPreview(next);
    } catch {
      setError('Non riesco a leggere questo file. Prova con il CSV o l’Excel dell’estratto conto; i file protetti da password non si possono aprire.');
    } finally {
      setReading(false);
    }
  }

  function reset() {
    setDraft(null);
    setPreview(null);
  }

  async function confirm() {
    if (!draft || !preview) return;
    const { count, undo } = await importMovements(previewDrafts(preview.rows, draft.accountId));
    const { headerRow } = draft.mapping;
    const headers = headerRow === null ? [] : (draft.sheets[draft.sheetIndex]?.rows[headerRow] ?? []);
    await saveProfile(
      {
        name: draft.bankName.trim() || (accountNames.get(draft.accountId) ?? 'Banca'),
        signature: signatureOf(headers),
        mapping: draft.mapping,
        accountId: draft.accountId,
      },
      draft.profileId,
    );
    notify(count === 1 ? '1 movimento importato' : `${count} movimenti importati`, undo);
    window.location.hash = routeHref('movimenti');
  }

  const back = { href: routeHref('impostazioni'), label: 'Impostazioni' };
  const cancel = draft && (
    <button type="button" onClick={reset} className="shrink-0 py-1 text-sm font-medium text-accent">
      Annulla
    </button>
  );

  if (draft && preview) {
    return (
      <Screen key="anteprima" title="Anteprima" action={cancel}>
        <ImportPreviewStep
          rows={preview.rows}
          skipped={preview.skipped}
          accountId={draft.accountId}
          bankName={draft.bankName}
          onChangeRows={(rows) => setPreview({ ...preview, rows })}
          onEditMapping={() => setPreview(null)}
          onConfirm={confirm}
        />
      </Screen>
    );
  }

  if (draft) {
    return (
      <Screen key="colonne" title="Colonne del file" action={cancel}>
        <ImportMappingStep draft={draft} onChange={setDraft} onContinue={() => showPreview(draft)} />
      </Screen>
    );
  }

  return (
    <Screen title="Importa estratto conto" back={back}>
      <div className="space-y-3">
        <p className="px-1 text-sm text-muted">
          Scarica l’estratto conto dalla tua banca in CSV o Excel e scegli il file. Resta sul telefono, e non cambia niente finché non confermi l’anteprima.
        </p>
        {activeAccounts.length === 0 ? (
          <>
            <p className="px-1 text-sm">Per importare serve almeno un conto.</p>
            <ButtonLink href={routeHref('impostazioni/conti')}>Crea un conto</ButtonLink>
          </>
        ) : (
          <Button className="w-full" disabled={reading} onClick={() => fileInput.current?.click()}>
            {reading ? 'Lettura del file…' : 'Scegli il file'}
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_FILES}
          aria-label="Scegli l’estratto conto"
          className="hidden"
          onChange={(event) => void chooseFile(event)}
        />
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      {importProfiles.length > 0 && (
        <>
          <SectionTitle>Banche salvate</SectionTitle>
          <ListGroup>
            {importProfiles.map((profile) => (
              <ButtonRow
                key={profile.id}
                onClick={() => setEditingProfile(profile)}
                detail={profile.accountId && accountNames.get(profile.accountId) !== profile.name ? accountNames.get(profile.accountId) : undefined}
              >
                {profile.name}
              </ButtonRow>
            ))}
          </ListGroup>
        </>
      )}

      {editingProfile && <ProfileEditor profile={editingProfile} onClose={() => setEditingProfile(null)} />}
    </Screen>
  );
}
