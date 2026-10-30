import { useAppUpdate } from '../pwa';

export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useAppUpdate();
  if (!updateAvailable) return null;

  return (
    <div role="status" className="flex items-center justify-between gap-3 border-t border-line bg-surface px-page py-2 text-sm">
      <span>Nuova versione disponibile</span>
      <button type="button" onClick={applyUpdate} className="min-h-11 px-2 font-semibold text-accent">
        Aggiorna
      </button>
    </div>
  );
}
