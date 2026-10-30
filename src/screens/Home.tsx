import { useMemo } from 'react';
import { useData } from '../db/DataProvider';
import { backupReminder } from '../domain/backup';
import { computeBalances, liquidityCents } from '../domain/balances';
import { formatMonthYear, startOfMonth } from '../domain/dates';
import { formatCents, formatRate } from '../domain/money';
import { lastVerifiedDate, verifiedLabel } from '../domain/reconcile';
import { summarizePeriod } from '../domain/reports';
import type { Account } from '../domain/types';
import { routeHref } from '../router';
import { ButtonLink, ListGroup, SectionTitle } from '../ui/controls';
import { openReconcile } from '../ui/reconcileStore';
import { RecurringCard } from '../ui/RecurringCard';
import { Screen } from '../ui/Screen';
import { useToday } from '../ui/useToday';

function AccountRow({
  account,
  balance,
  verified,
  onPress,
}: {
  account: Account;
  balance: number;
  verified: string;
  onPress: () => void;
}) {
  return (
    <button type="button" onClick={onPress} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-bg">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{account.name}</span>
        <span className="block truncate text-xs text-muted">{verified}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block tabular-nums ${balance < 0 ? 'text-danger' : ''}`}>{formatCents(balance)}</span>
        <span className="block text-xs font-medium text-accent">Aggiorna saldo reale</span>
      </span>
    </button>
  );
}

function MonthTile({ label, value, negative = false }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className={`truncate text-lg font-semibold tabular-nums ${negative ? 'text-danger' : ''}`}>{value}</dd>
    </div>
  );
}

export function Home() {
  const { accounts, transactions, reconciliations, settings } = useData();
  const today = useToday();

  const balances = useMemo(() => computeBalances(accounts, transactions, today), [accounts, transactions, today]);
  const month = useMemo(() => summarizePeriod(transactions, startOfMonth(today), today), [transactions, today]);

  const liquidity = liquidityCents(accounts, balances);
  const active = accounts.filter((account) => !account.archived);
  const liquid = active.filter((account) => account.contaComeLiquidita);
  const others = active.filter((account) => !account.contaComeLiquidita);
  const hasData = accounts.length > 0 || transactions.length > 0;
  const reminder = backupReminder(settings.lastBackupAt, hasData && !settings.demoLoaded, today);

  const row = (account: Account) => (
    <AccountRow
      key={account.id}
      account={account}
      balance={balances.get(account.id) ?? 0}
      verified={verifiedLabel(lastVerifiedDate(account, reconciliations), today)}
      onPress={() => openReconcile(account.id, today)}
    />
  );

  return (
    <Screen
      hero={
        <>
          <h1 className="text-sm font-medium text-muted">Liquidità disponibile</h1>
          <p className={`text-4xl font-bold tabular-nums ${liquidity < 0 ? 'text-danger' : ''}`}>{formatCents(liquidity)}</p>
        </>
      }
    >
      {settings.demoLoaded && (
        <p className="mb-4 rounded-2xl bg-surface px-4 py-3 text-sm">
          Stai vedendo dati inventati.{' '}
          <a href={routeHref('impostazioni/dati')} className="font-semibold text-accent">
            Rimuovili
          </a>{' '}
          quando vuoi iniziare con i tuoi.
        </p>
      )}

      {reminder && (
        <a
          href={routeHref('impostazioni/dati')}
          className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-2xl bg-surface px-4 text-sm"
        >
          <span className="min-w-0 truncate text-muted">
            {reminder.kind === 'never' ? 'Non hai ancora fatto un backup' : `Ultimo backup ${reminder.days} giorni fa`}
          </span>
          <span className="shrink-0 font-medium text-accent">Esporta</span>
        </a>
      )}

      <RecurringCard today={today} />

      {active.length === 0 ? (
        <section className="mb-4 space-y-3 rounded-2xl bg-surface p-4">
          <h2 className="font-semibold">Per iniziare, crea il tuo primo conto</h2>
          <p className="text-sm text-muted">Inserisci il saldo che vedi oggi nell’app della banca.</p>
          <ButtonLink href={routeHref('impostazioni/conti')}>Crea un conto</ButtonLink>
          {!hasData && (
            <a href={routeHref('impostazioni/dati')} className="block text-center text-sm font-medium text-accent">
              Oppure prova con i dati demo
            </a>
          )}
        </section>
      ) : (
        <>
          {liquid.length > 0 && <ListGroup>{liquid.map(row)}</ListGroup>}
          {others.length > 0 && (
            <>
              <SectionTitle>Fuori dalla liquidità</SectionTitle>
              <ListGroup>{others.map(row)}</ListGroup>
            </>
          )}
        </>
      )}

      <SectionTitle>{formatMonthYear(today)}</SectionTitle>
      <div className="rounded-2xl bg-surface">
        <dl className="grid grid-cols-2 [&>*:nth-child(even)]:border-l [&>*:nth-child(even)]:border-line [&>*:nth-child(n+3)]:border-t [&>*:nth-child(n+3)]:border-line">
          <MonthTile label="Entrate" value={formatCents(month.incomeCents)} />
          <MonthTile label="Uscite" value={formatCents(month.expenseCents)} />
          <MonthTile label="Risparmio netto" value={formatCents(month.savingsCents)} negative={month.savingsCents < 0} />
          <MonthTile
            label="Tasso di risparmio"
            value={month.savingsRate === null ? '—' : formatRate(month.savingsRate)}
            negative={month.savingsCents < 0}
          />
        </dl>
        {month.adjustmentCents !== 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Il risparmio comprende {formatCents(month.adjustmentCents)} di rettifiche.
          </p>
        )}
      </div>
    </Screen>
  );
}
