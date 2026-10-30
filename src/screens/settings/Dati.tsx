import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import {
  clearAllData,
  loadDemoData,
  readAllData,
  replaceAllData,
  setSetting,
  SETTING_LAST_BACKUP,
} from '../../db/data';
import { useData } from '../../db/DataProvider';
import { parseBackup, summarizeData, type BackupFile, type BackupSummary } from '../../domain/backup';
import { transactionsToCsv } from '../../domain/csv';
import { formatFullDate, toIsoDate, todayIso } from '../../domain/dates';
import { routeHref } from '../../router';
import { Button, Field, ListGroup, SectionTitle, TextInput } from '../../ui/controls';
import { forgetUndo, notify, notifyError } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { backupFile, shareOrDownload } from '../../ui/shareFile';
import { Sheet } from '../../ui/Sheet';

const CLEAR_WORD = 'CANCELLA';

function periodText(summary: BackupSummary): string {
  if (!summary.firstDate || !summary.lastDate) return '';
  return ` (dal ${formatFullDate(summary.firstDate)} al ${formatFullDate(summary.lastDate)})`;
}

function ImportPreview({
  backup,
  current,
  onExportCurrent,
  onClose,
}: {
  backup: BackupFile;
  current: BackupSummary;
  onExportCurrent: () => void;
  onClose: () => void;
}) {
  const incoming = summarizeData(backup.data);

  async function confirm() {
    try {
      await replaceAllData(backup.data);
      forgetUndo();
      notify('Backup importato');
      onClose();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <Sheet title="Importa backup" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Backup del {formatFullDate(toIsoDate(new Date(backup.exportedAt)))}</p>
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-medium" />
              <th className="py-1 text-right font-medium">Nel file</th>
              <th className="py-1 text-right font-medium">Ora nell’app</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1">Conti</td>
              <td className="py-1 text-right">{incoming.accounts}</td>
              <td className="py-1 text-right">{current.accounts}</td>
            </tr>
            <tr>
              <td className="py-1">Categorie</td>
              <td className="py-1 text-right">{incoming.categories}</td>
              <td className="py-1 text-right">{current.categories}</td>
            </tr>
            <tr>
              <td className="py-1">Movimenti</td>
              <td className="py-1 text-right">{incoming.transactions}</td>
              <td className="py-1 text-right">{current.transactions}</td>
            </tr>
            {(incoming.holdings > 0 || current.holdings > 0) && (
              <tr>
                <td className="py-1">Strumenti</td>
                <td className="py-1 text-right">{incoming.holdings}</td>
                <td className="py-1 text-right">{current.holdings}</td>
              </tr>
            )}
          </tbody>
        </table>
        {incoming.transactions > 0 && <p className="text-sm text-muted">Movimenti del file{periodText(incoming)}.</p>}
        <p className="text-sm font-medium text-danger">
          Tutti i dati ora nell’app verranno sostituiti, e non si potrà annullare.
        </p>
        {current.transactions > 0 && (
          <Button variant="secondary" className="w-full" onClick={onExportCurrent}>
            Esporta prima i dati attuali
          </Button>
        )}
        <Button variant="danger" className="w-full" onClick={() => void confirm()}>
          Sostituisci i dati
        </Button>
        <Button variant="secondary" className="w-full" onClick={onClose}>
          Annulla
        </Button>
      </div>
    </Sheet>
  );
}

function ClearData({ onClose }: { onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [word, setWord] = useState('');

  async function clear() {
    try {
      await clearAllData();
      forgetUndo();
      notify('Tutti i dati sono stati cancellati');
      onClose();
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <Sheet title="Cancella tutti i dati" onClose={onClose}>
      {confirmed ? (
        <div className="space-y-3">
          <Field label={`Per confermare scrivi ${CLEAR_WORD}`}>
            <TextInput value={word} onChange={(event) => setWord(event.target.value)} autoComplete="off" autoCapitalize="characters" />
          </Field>
          <Button
            variant="danger"
            className="w-full"
            disabled={word.trim().toUpperCase() !== CLEAR_WORD}
            onClick={() => void clear()}
          >
            Cancella definitivamente
          </Button>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Annulla
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p>Conti, movimenti e categorie personalizzate verranno cancellati da questo telefono. Non si potrà annullare.</p>
          <Button variant="secondary" className="w-full" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmed(true)}>
            Continua
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function Dati() {
  const { accounts, categories, holdings, transactions, settings } = useData();
  // Letti in anticipo: l'esportazione deve partire subito dentro il tocco.
  const snapshot = useLiveQuery(readAllData);
  const [preview, setPreview] = useState<BackupFile | null>(null);
  const [importError, setImportError] = useState('');
  const [clearing, setClearing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasData = accounts.length > 0 || transactions.length > 0;
  const lastBackup = settings.lastBackupAt ? formatFullDate(toIsoDate(new Date(settings.lastBackupAt))) : 'mai';

  async function exportBackup() {
    if (!snapshot) return;
    try {
      const outcome = await shareOrDownload(backupFile(snapshot));
      if (outcome === 'cancelled') return;
      await setSetting(SETTING_LAST_BACKUP, new Date().toISOString());
      notify('Backup esportato');
    } catch (error) {
      notifyError(error);
    }
  }

  async function exportCsv() {
    const file = new File([transactionsToCsv(transactions, accounts, categories)], `finanze-movimenti-${todayIso()}.csv`, {
      type: 'text/csv',
    });
    try {
      await shareOrDownload(file);
    } catch (error) {
      notifyError(error);
    }
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError('');
    const result = parseBackup(await file.text());
    if (result.ok) setPreview(result.backup);
    else setImportError(result.error);
  }

  async function loadDemo() {
    try {
      await loadDemoData(todayIso());
      notify('Dati demo caricati');
    } catch (error) {
      notifyError(error);
    }
  }

  async function removeDemo() {
    try {
      await clearAllData();
      forgetUndo();
      notify('Dati demo rimossi');
    } catch (error) {
      notifyError(error);
    }
  }

  return (
    <Screen title="Backup e dati" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      <SectionTitle>Backup</SectionTitle>
      <div className="space-y-2">
        <p className="px-1 text-sm text-muted">
          Se elimini l’icona dalla Home perdi i dati: tieni una copia su iCloud Drive o File. Ultimo backup: {lastBackup}.
        </p>
        <Button className="w-full" disabled={!snapshot} onClick={() => void exportBackup()}>
          Esporta backup
        </Button>
        <Button variant="secondary" className="w-full" onClick={() => fileInput.current?.click()}>
          Importa backup
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Scegli il file di backup"
          className="hidden"
          onChange={(event) => void chooseFile(event)}
        />
        {importError && (
          <p role="alert" className="px-1 text-sm text-danger">
            {importError}
          </p>
        )}
      </div>

      <SectionTitle>Esportazioni</SectionTitle>
      <Button variant="secondary" className="w-full" disabled={transactions.length === 0} onClick={() => void exportCsv()}>
        Esporta movimenti in CSV
      </Button>

      <SectionTitle>Dati demo</SectionTitle>
      <div className="space-y-2">
        {settings.demoLoaded ? (
          <Button variant="secondary" className="w-full" onClick={() => void removeDemo()}>
            Rimuovi dati demo
          </Button>
        ) : (
          <>
            <Button variant="secondary" className="w-full" disabled={hasData} onClick={() => void loadDemo()}>
              Carica dati demo
            </Button>
            <p className="px-1 text-xs text-muted">
              {hasData ? 'Si possono caricare solo su un’app vuota.' : 'Conti e movimenti inventati, per provare l’app.'}
            </p>
          </>
        )}
      </div>

      <SectionTitle>Zona pericolosa</SectionTitle>
      <ListGroup>
        <button type="button" onClick={() => setClearing(true)} className="min-h-13 w-full px-4 text-left text-danger active:bg-bg">
          Cancella tutti i dati
        </button>
      </ListGroup>

      {preview && (
        <ImportPreview
          backup={preview}
          current={summarizeData({ accounts, categories, holdings, transactions })}
          onExportCurrent={() => void exportBackup()}
          onClose={() => setPreview(null)}
        />
      )}
      {clearing && <ClearData onClose={() => setClearing(false)} />}
    </Screen>
  );
}
