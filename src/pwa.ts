import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function useAppUpdate() {
  const {
    needRefresh: [updateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Un'app installata che torna in primo piano non è una navigazione:
      // senza questo controllo su iOS gli aggiornamenti arriverebbero molto tardi.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          registration.update().catch(() => {});
        }
      });
    },
  });

  return {
    updateAvailable,
    applyUpdate() {
      // Il plugin ricarica solo se la pagina aveva già un service worker quando si è aperta:
      // nella prima sessione dopo l'installazione "Aggiorna" resterebbe senza effetto.
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
        once: true,
      });
      void updateServiceWorker();
    },
  };
}

export interface InstallStatus {
  installed: boolean;
  offlineReady: boolean;
  online: boolean;
  persistent: boolean | null;
}

export function useInstallStatus(): InstallStatus {
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [persistent, setPersistent] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    navigator.serviceWorker?.ready.then(() => {
      if (active) setOfflineReady(true);
    });

    navigator.storage?.persist?.().then(
      (granted) => {
        if (active) setPersistent(granted);
      },
      () => {
        if (active) setPersistent(false);
      },
    );

    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);

    return () => {
      active = false;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const installed =
    navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

  return { installed, offlineReady, online, persistent };
}
