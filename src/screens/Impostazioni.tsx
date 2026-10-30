import { useData } from '../db/DataProvider';
import { formatFullDate, toIsoDate } from '../domain/dates';
import { routeHref } from '../router';
import { LinkRow, ListGroup, SectionTitle } from '../ui/controls';
import { InstallStatusPanel } from '../ui/InstallStatusPanel';
import { Screen } from '../ui/Screen';

export function Impostazioni() {
  const { accounts, categories, recurring, settings } = useData();
  const activeAccounts = accounts.filter((account) => !account.archived).length;
  const visibleCategories = categories.filter((category) => category.kind !== 'rettifica').length;
  const lastBackup = settings.lastBackupAt ? formatFullDate(toIsoDate(new Date(settings.lastBackupAt))) : 'mai';

  return (
    <Screen title="Impostazioni">
      <ListGroup>
        <LinkRow href={routeHref('impostazioni/conti')} title="Conti" detail={String(activeAccounts)} />
        <LinkRow href={routeHref('impostazioni/categorie')} title="Categorie" detail={String(visibleCategories)} />
        <LinkRow href={routeHref('impostazioni/ricorrenze')} title="Ricorrenze" detail={String(recurring.length)} />
        <LinkRow href={routeHref('impostazioni/dati')} title="Backup e dati" detail={`Ultimo: ${lastBackup}`} />
      </ListGroup>
      <SectionTitle>Stato dell’app</SectionTitle>
      <InstallStatusPanel />
    </Screen>
  );
}
