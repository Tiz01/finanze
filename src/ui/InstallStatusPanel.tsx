import { useInstallStatus } from '../pwa';

function StatusRow({ label, value, good }: { label: string; value: string; good: boolean | null }) {
  const dot = good === null ? 'bg-line' : good ? 'bg-accent' : 'bg-muted';
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
      <dt>{label}</dt>
      <dd className="flex items-center gap-2 text-muted">
        {value}
        <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      </dd>
    </div>
  );
}

export function InstallStatusPanel() {
  const { installed, offlineReady, online, persistent } = useInstallStatus();

  return (
    <dl className="divide-y divide-line rounded-2xl bg-surface">
      <StatusRow label="Aperta da" value={installed ? 'Icona sulla Home' : 'Browser'} good={installed} />
      <StatusRow label="Uso offline" value={offlineReady ? 'Pronto' : 'In preparazione'} good={offlineReady} />
      <StatusRow label="Connessione" value={online ? 'Online' : 'Offline'} good={null} />
      <StatusRow
        label="Archivio persistente"
        value={persistent === null ? 'Verifica in corso' : persistent ? 'Sì' : 'Non garantito'}
        good={persistent}
      />
      <StatusRow label="Versione" value={__BUILD_ID__} good={null} />
    </dl>
  );
}
