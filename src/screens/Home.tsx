import { useData } from '../db/DataProvider';
import { useInstallStatus } from '../pwa';
import { routeHref } from '../router';
import { ButtonLink } from '../ui/controls';
import { Screen } from '../ui/Screen';

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

export function Home() {
  const { accounts, settings } = useData();
  const { installed, offlineReady, online, persistent } = useInstallStatus();

  return (
    <Screen title="Finanze">
      {settings.demoLoaded && (
        <p className="mb-4 rounded-2xl bg-surface px-4 py-3 text-sm">
          Stai vedendo dati inventati.{' '}
          <a href={routeHref('impostazioni/dati')} className="font-semibold text-accent">
            Rimuovili
          </a>{' '}
          quando vuoi iniziare con i tuoi.
        </p>
      )}
      {accounts.length === 0 && (
        <section className="mb-4 space-y-3 rounded-2xl bg-surface p-4">
          <h2 className="font-semibold">Per iniziare, crea il tuo primo conto</h2>
          <p className="text-sm text-muted">Inserisci il saldo che vedi oggi nell’app della banca.</p>
          <ButtonLink href={routeHref('impostazioni/conti')}>Crea un conto</ButtonLink>
          <a href={routeHref('impostazioni/dati')} className="block text-center text-sm font-medium text-accent">
            Oppure prova con i dati demo
          </a>
        </section>
      )}
      <h2 className="px-1 pb-2 text-sm font-semibold text-muted">Stato dell’installazione</h2>
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
    </Screen>
  );
}
