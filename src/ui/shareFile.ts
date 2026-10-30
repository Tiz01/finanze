import { buildBackup, serializeBackup, type BackupData } from '../domain/backup';
import { todayIso } from '../domain/dates';

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** Da chiamare subito dentro il tocco: iOS rifiuta la condivisione se passa troppo tempo. */
export async function shareOrDownload(file: File): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export function backupFile(data: BackupData): File {
  return new File([serializeBackup(buildBackup(data))], `finanze-backup-${todayIso()}.json`, { type: 'application/json' });
}
