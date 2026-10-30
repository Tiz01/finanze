import { Component, useEffect, useState, type ReactNode } from 'react';
import { readAllData, setSetting, SETTING_LAST_BACKUP } from '../db/data';
import { notify, notifyError } from './feedback';
import { backupFile, shareOrDownload } from './shareFile';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

function ExportBackup() {
  // Letto subito e direttamente dall'archivio: qui non c'è l'app sopra, e la condivisione deve partire dentro il tocco.
  const [file, setFile] = useState<File | null>(null);
  const [unreadable, setUnreadable] = useState(false);

  useEffect(() => {
    let active = true;
    readAllData()
      .then((data) => {
        if (active) setFile(backupFile(data));
      })
      .catch(() => {
        if (active) setUnreadable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function share() {
    if (!file) return;
    try {
      const outcome = await shareOrDownload(file);
      if (outcome === 'cancelled') return;
      await setSetting(SETTING_LAST_BACKUP, new Date().toISOString());
      notify('Backup esportato');
    } catch (error) {
      notifyError(error);
    }
  }

  if (unreadable) return <p className="mt-4 text-sm text-danger">Non riesco a leggere i dati per farne una copia.</p>;
  return (
    <button
      type="button"
      disabled={!file}
      onClick={() => void share()}
      className="mt-2 min-h-12 w-full rounded-xl border border-line bg-surface px-4 font-semibold active:opacity-80 disabled:opacity-40"
    >
      Esporta backup
    </button>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <main role="alert" className="min-h-0 flex-1 overflow-y-auto bg-bg px-page pt-20 text-center">
        <p className="font-semibold">Qualcosa è andato storto</p>
        <p className="mt-2 text-sm text-muted">{this.state.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-12 w-full rounded-xl bg-accent px-4 font-semibold text-on-accent"
        >
          Ricarica
        </button>
        <ExportBackup />
      </main>
    );
  }
}
