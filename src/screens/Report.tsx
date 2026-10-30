import { useMemo, useState, type ReactNode } from 'react';
import { useData } from '../db/DataProvider';
import { computeBalances, liquidityCents, liquiditySeries } from '../domain/balances';
import { formatCents, formatOneDecimal, formatRate, formatSignedCents } from '../domain/money';
import {
  formatMonthShort,
  formatPeriod,
  periodRangeFor,
  PERIOD_KINDS,
  shiftPeriod,
  type DateRange,
  type PeriodKind,
} from '../domain/periods';
import {
  autonomyMonths,
  averageMonthlyExpense,
  baselineMonths,
  expensesByCategory,
  monthlyBreakdown,
  summarizePeriod,
  type CategoryExpense,
  type IncomeSources,
} from '../domain/reports';
import type { Category } from '../domain/types';
import { Field, SectionTitle, Segmented, TextInput } from '../ui/controls';
import { Screen } from '../ui/Screen';
import { StatGrid, StatTile } from '../ui/stats';
import { ValueChart } from '../ui/ValueChart';
import { useToday } from '../ui/useToday';

const KIND_LABELS: Record<PeriodKind, string> = {
  mese: 'Mese',
  trimestre: 'Trimestre',
  anno: 'Anno',
  personalizzato: 'Personalizzato',
};
const KIND_OPTIONS = PERIOD_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));

function percent(ratio: number): string {
  return `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <div className="rounded-2xl bg-surface p-4">{children}</div>
    </>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** Barra orizzontale di una sola tinta: la lunghezza dice già quanto, e il valore è sempre scritto. */
function BarRow({
  label,
  value,
  ratio,
  tickRatio,
  note,
}: {
  label: ReactNode;
  value: string;
  ratio: number;
  tickRatio?: number;
  note?: ReactNode;
}) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">{value}</span>
      </div>
      {(ratio > 0 || tickRatio !== undefined) && (
        <div className="relative mt-1.5 h-2" aria-hidden="true">
          {ratio > 0 && <div className="h-full min-w-0.5 rounded-r-[4px] bg-series-1" style={{ width: percent(ratio) }} />}
          {tickRatio !== undefined && (
            <span className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 bg-ink" style={{ left: percent(tickRatio) }} />
          )}
        </div>
      )}
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </li>
  );
}

function IncomeBySource({ sources, totalCents, nettedCents }: { sources: IncomeSources; totalCents: number; nettedCents: number }) {
  const rows = [
    { label: 'Stipendio', cents: sources.salaryCents },
    { label: 'Regali e soldi ricevuti', cents: sources.giftsCents },
    { label: 'Rimborsi', cents: sources.refundsCents },
    { label: 'Altro', cents: sources.otherCents },
  ];
  const largest = Math.max(...rows.map((row) => row.cents));

  return (
    <>
      {totalCents === 0 ? (
        <EmptyNote>Nessuna entrata in questo periodo.</EmptyNote>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <BarRow
              key={row.label}
              label={row.label}
              value={formatCents(row.cents)}
              ratio={row.cents / largest}
              note={row.cents > 0 ? `${formatRate(row.cents / totalCents)} delle entrate` : undefined}
            />
          ))}
        </ul>
      )}
      {nettedCents > 0 && (
        <p className="pt-3 text-xs text-muted">Altri {formatCents(nettedCents)} di rimborsi sono già sottratti dalle spese.</p>
      )}
    </>
  );
}

function deltaNote(row: CategoryExpense): ReactNode {
  const expected = row.expectedCents ?? 0;
  if (expected === 0) return row.cents > 0 ? 'Nessuna spesa nei mesi di confronto' : null;
  const change = (row.cents - expected) / expected;
  if (Math.round(change * 100) === 0) return 'In linea';
  const up = change > 0;
  return <span className={up ? 'text-danger' : 'text-positive'}>{`${up ? '+' : ''}${formatRate(change)}`}</span>;
}

function ExpensesByCategory({
  rows,
  categories,
  baselineCount,
  isMonth,
}: {
  rows: CategoryExpense[];
  categories: Map<string, Category>;
  baselineCount: number;
  isMonth: boolean;
}) {
  if (rows.length === 0) return <EmptyNote>Nessuna spesa in questo periodo.</EmptyNote>;

  const largest = Math.max(...rows.map((row) => Math.max(row.cents, row.expectedCents ?? 0)));
  const baselineLabel = baselineCount === 1 ? 'Media dell’ultimo mese' : `Media ${baselineCount} mesi`;

  return (
    <>
      {baselineCount > 0 && (
        <p className="flex items-center gap-2 pb-3 text-xs text-muted">
          <span className="h-3 w-0.5 shrink-0 bg-ink" aria-hidden="true" />
          La tacca è la media dei {baselineCount === 1 ? 'mese' : `${baselineCount} mesi`} prima del periodo
        </p>
      )}
      <ul className="space-y-3.5">
        {rows.map((row) => {
          const category = categories.get(row.categoryId);
          const delta = deltaNote(row);
          return (
            <BarRow
              key={row.categoryId}
              label={
                <>
                  <span aria-hidden="true">{category?.emoji} </span>
                  {category?.name}
                </>
              }
              value={formatCents(row.cents)}
              ratio={row.cents / largest}
              tickRatio={row.expectedCents === null ? undefined : row.expectedCents / largest}
              note={
                row.averageCents === null ? undefined : (
                  <>
                    {baselineLabel}: {formatCents(row.averageCents)}
                    {isMonth ? '' : ' al mese'}
                    {delta && <> · {delta}</>}
                  </>
                )
              }
            />
          );
        })}
      </ul>
    </>
  );
}

function FixedVersusVariable({ fixedCents, variableCents }: { fixedCents: number; variableCents: number }) {
  const total = fixedCents + variableCents;
  if (total === 0) return <EmptyNote>Nessuna spesa in questo periodo.</EmptyNote>;

  const rows = [
    { label: 'Fisse', cents: fixedCents, fill: 'bg-series-1' },
    { label: 'Variabili', cents: variableCents, fill: 'bg-series-2' },
  ];

  return (
    <>
      {/* Lo spazio tra i due tratti li separa senza bisogno di un bordo. */}
      <div className="flex h-3 gap-0.5" aria-hidden="true">
        {rows
          .filter((row) => row.cents > 0)
          .map((row) => (
            <div key={row.label} className={`first:rounded-l-[2px] last:rounded-r-[4px] ${row.fill}`} style={{ flexGrow: row.cents, flexBasis: 0 }} />
          ))}
      </div>
      <dl className="space-y-1.5 pt-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-[2px] ${row.fill}`} aria-hidden="true" />
            <dt className="min-w-0 flex-1">{row.label}</dt>
            <dd className="font-medium tabular-nums">{formatCents(row.cents)}</dd>
            <dd className="w-11 text-right text-muted tabular-nums">{formatRate(row.cents / total)}</dd>
          </div>
        ))}
      </dl>
      <p className="pt-2 text-xs text-muted">Fisse: le categorie segnate come fisse e i movimenti delle ricorrenze.</p>
    </>
  );
}

function MonthByMonth({ rows }: { rows: ReturnType<typeof monthlyBreakdown> }) {
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-right text-xs text-muted">
          <th className="pb-1.5 text-left font-medium">Mese</th>
          <th className="pb-1.5 font-medium">Entrate</th>
          <th className="pb-1.5 font-medium">Uscite</th>
          <th className="pb-1.5 font-medium">Risparmio</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line text-right">
        {rows.map((row) => (
          <tr key={row.month}>
            <td className="py-1.5 text-left text-muted">{formatMonthShort(row.month)}</td>
            <td className="py-1.5">{formatCents(row.incomeCents)}</td>
            <td className="py-1.5">{formatCents(row.expenseCents)}</td>
            <td className={`py-1.5 ${row.savingsCents < 0 ? 'text-danger' : ''}`}>{formatCents(row.savingsCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PeriodStepper({ label, onPrevious, onNext, canGoNext }: { label: string; onPrevious: () => void; onNext: () => void; canGoNext: boolean }) {
  const arrow = 'flex size-11 items-center justify-center rounded-full text-accent active:bg-bg disabled:text-line';
  return (
    <div className="flex items-center justify-between">
      <button type="button" aria-label="Periodo precedente" onClick={onPrevious} className={arrow}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <h2 className="font-semibold">{label}</h2>
      <button type="button" aria-label="Periodo successivo" onClick={onNext} disabled={!canGoNext} className={arrow}>
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

export function Report() {
  const data = useData();
  const { accounts, categories, transactions } = data;
  const today = useToday();

  const [kind, setKind] = useState<PeriodKind>('mese');
  const [anchor, setAnchor] = useState(today);
  const [customFrom, setCustomFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [customTo, setCustomTo] = useState(today);

  const range: DateRange =
    kind === 'personalizzato'
      ? { from: customFrom <= customTo ? customFrom : customTo, to: customFrom <= customTo ? customTo : customFrom }
      : periodRangeFor(kind, anchor);
  // Ciò che ha una data futura non è ancora successo: come per i saldi, non conta.
  const from = range.from > today ? today : range.from;
  const to = range.to > today ? today : range.to;

  const summary = useMemo(() => summarizePeriod(data, from, to), [data, from, to]);
  const rows = useMemo(() => expensesByCategory(transactions, from, to), [transactions, from, to]);
  const baselineCount = useMemo(() => baselineMonths(transactions, from).length, [transactions, from]);
  const months = useMemo(() => monthlyBreakdown(data, from, to), [data, from, to]);
  const series = useMemo(() => liquiditySeries(accounts, transactions, from, to), [accounts, transactions, from, to]);

  const autonomy = useMemo(() => {
    const liquidity = liquidityCents(accounts, computeBalances(accounts, transactions, today));
    const baseline = averageMonthlyExpense(transactions, today);
    return {
      months: autonomyMonths(liquidity, baseline?.averageCents ?? null),
      hint: baseline
        ? `Oggi · ${baseline.months.length === 1 ? 'spese dell’ultimo mese' : `media ${baseline.months.length} mesi`}: ${formatCents(baseline.averageCents)}`
        : 'Serve almeno un mese completo di spese',
    };
  }, [accounts, transactions, today]);

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);

  function changeKind(next: PeriodKind) {
    if (next === 'personalizzato') {
      setCustomFrom(from);
      setCustomTo(to);
    }
    setKind(next);
  }

  const isCurrent = kind !== 'personalizzato' && range.to >= today;
  const investedLabel = kind === 'mese' ? (isCurrent ? 'Investito questo mese' : 'Investito nel mese') : 'Investito nel periodo';

  if (accounts.length === 0 && transactions.length === 0) {
    return (
      <Screen title="Report">
        <p className="pt-8 text-center text-muted">Il report si riempie quando crei un conto e registri i primi movimenti.</p>
      </Screen>
    );
  }

  return (
    <Screen title="Report">
      <div className="space-y-2">
        <Segmented options={KIND_OPTIONS} value={kind} onChange={changeKind} fitLabels />
        {kind === 'personalizzato' ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Dal">
              <TextInput
                type="date"
                value={customFrom}
                onChange={(event) => {
                  if (event.target.value) setCustomFrom(event.target.value);
                }}
              />
            </Field>
            <Field label="Al">
              <TextInput
                type="date"
                value={customTo}
                onChange={(event) => {
                  if (event.target.value) setCustomTo(event.target.value);
                }}
              />
            </Field>
          </div>
        ) : (
          <PeriodStepper
            label={formatPeriod(kind, range)}
            onPrevious={() => setAnchor(shiftPeriod(kind, anchor, -1))}
            onNext={() => setAnchor(shiftPeriod(kind, anchor, 1))}
            canGoNext={!isCurrent}
          />
        )}
      </div>

      <SectionTitle>Riepilogo</SectionTitle>
      <div className="rounded-2xl bg-surface">
        <StatGrid>
          <StatTile label="Entrate" value={formatCents(summary.incomeCents)} />
          <StatTile label="Uscite" value={formatCents(summary.expenseCents)} />
          <StatTile label="Risparmio netto" value={formatCents(summary.savingsCents)} negative={summary.savingsCents < 0} />
          <StatTile label={investedLabel} value={formatCents(summary.investedCents)} />
          <StatTile
            label="Rettifiche"
            value={formatCents(summary.adjustmentCents)}
            hint="Soldi non tracciati"
            negative={summary.adjustmentCents < 0}
          />
          <StatTile
            label="Mesi di autonomia"
            value={autonomy.months === null ? '—' : formatOneDecimal(autonomy.months)}
            hint={autonomy.hint}
          />
        </StatGrid>
        {summary.marketCents !== 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            I conti investimento sono variati di {formatSignedCents(summary.marketCents)} per il mercato: non conta nel risparmio.
          </p>
        )}
      </div>

      <SectionTitle>Tasso di risparmio</SectionTitle>
      <div className="rounded-2xl bg-surface">
        <StatGrid>
          <StatTile
            label="Sul solo stipendio"
            value={summary.salarySavingsRate === null ? '—' : formatRate(summary.salarySavingsRate)}
            hint={summary.salarySavingsRate === null ? 'Nessuno stipendio nel periodo' : undefined}
            negative={summary.salarySavingsRate !== null && summary.salarySavingsRate < 0}
          />
          <StatTile
            label="Su tutte le entrate"
            value={summary.savingsRate === null ? '—' : formatRate(summary.savingsRate)}
            hint={summary.savingsRate === null ? 'Nessuna entrata nel periodo' : undefined}
            negative={summary.savingsRate !== null && summary.savingsRate < 0}
          />
        </StatGrid>
      </div>

      <Card title="Entrate per fonte">
        <IncomeBySource sources={summary.sources} totalCents={summary.incomeCents} nettedCents={summary.nettedRefundsCents} />
      </Card>

      <Card title="Spese per categoria">
        <ExpensesByCategory rows={rows} categories={categoriesById} baselineCount={baselineCount} isMonth={kind === 'mese'} />
      </Card>

      <Card title="Spese fisse e variabili">
        <FixedVersusVariable fixedCents={summary.fixedCents} variableCents={summary.variableCents} />
      </Card>

      <Card title="Andamento della liquidità">
        {series.length >= 2 ? (
          <ValueChart points={series} today={today} />
        ) : series[0] ? (
          <EmptyNote>
            Per ora c’è un solo giorno: {formatCents(series[0].cents)}. La linea compare dal secondo giorno dopo aver inserito i saldi dei conti.
          </EmptyNote>
        ) : (
          <EmptyNote>Nessun saldo in questo periodo: la linea parte dalla data del saldo iniziale dei conti.</EmptyNote>
        )}
      </Card>

      {months.length > 1 && (
        <Card title="Mese per mese">
          <MonthByMonth rows={months} />
        </Card>
      )}
    </Screen>
  );
}
