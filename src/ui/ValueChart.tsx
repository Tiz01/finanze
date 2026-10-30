import { useState, type MouseEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { axisTicks, thinOut } from '../domain/balances';
import { formatFullDate, formatShortDate } from '../domain/dates';
import { formatCents, formatCentsRounded } from '../domain/money';
import type { IsoDate } from '../domain/types';

const AXIS_TEXT = { fontSize: 11, fill: 'var(--muted)' };
const MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };
const Y_AXIS_WIDTH = 56;
const TABLE_ROWS = 12;

export interface ValuePoint {
  date: IsoDate;
  cents: number;
  /** Una seconda linea di confronto, per esempio il costo di acquisto. */
  baselineCents?: number;
}

function LegendItem({ label, swatch }: { label: string; swatch: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 shrink-0 rounded-[2px] ${swatch}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ValueChart({
  points,
  today,
  valueLabel = 'Valore',
  baselineLabel,
}: {
  points: ValuePoint[];
  today: IsoDate;
  valueLabel?: string;
  /** Se c'è, disegna anche la seconda linea e la legenda. */
  baselineLabel?: string;
}) {
  // Il valore si legge sopra il grafico: un'etichetta che segue il dito finirebbe sotto il dito.
  const [selectedDate, setSelectedDate] = useState<IsoDate | null>(null);
  const selected = points.find((point) => point.date === selectedDate);

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  const showBaseline = baselineLabel !== undefined;
  const values = points.flatMap((point) => (showBaseline ? [point.cents, point.baselineCents ?? point.cents] : [point.cents]));
  const ticks = axisTicks(Math.min(...values), Math.max(...values));

  // I punti sono equidistanti, quindi la posizione del dito dice già quale giorno è.
  function dateAt(event: MouseEvent<HTMLDivElement>): IsoDate | null {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - Y_AXIS_WIDTH) / (box.width - Y_AXIS_WIDTH - MARGIN.right);
    return points[Math.round(Math.max(0, Math.min(1, ratio)) * (points.length - 1))]?.date ?? null;
  }

  return (
    <>
      <p className="pb-2 text-sm text-muted" aria-live="polite">
        {selected ? (
          <>
            {formatFullDate(selected.date)}: <span className="font-semibold text-ink">{formatCents(selected.cents)}</span>
            {showBaseline && selected.baselineCents !== undefined && ` · costo ${formatCents(selected.baselineCents)}`}
          </>
        ) : (
          <>
            Da {formatCents(first.cents)} a <span className="font-semibold text-ink">{formatCents(last.cents)}</span>
          </>
        )}
      </p>
      {/* In verticale il dito fa scorrere la pagina, in orizzontale percorre il grafico. */}
      <div
        className="h-52 touch-pan-y"
        onClick={(event) => setSelectedDate(dateAt(event))}
        onPointerMove={(event) => {
          if (event.buttons > 0) setSelectedDate(dateAt(event));
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={MARGIN} accessibilityLayer={false}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="date"
              tick={AXIS_TEXT}
              tickLine={false}
              axisLine={{ stroke: 'var(--line)' }}
              tickFormatter={(date: string) => formatShortDate(date, today)}
              interval="preserveStartEnd"
              minTickGap={48}
            />
            <YAxis
              width={Y_AXIS_WIDTH}
              tick={AXIS_TEXT}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
              domain={[ticks[0] ?? 0, ticks.at(-1) ?? 0]}
              interval={0}
              tickFormatter={formatCentsRounded}
            />
            {/* A gradini: tra un movimento e l'altro il valore resta fermo. */}
            {showBaseline && (
              <Line
                type="stepAfter"
                dataKey="baselineCents"
                stroke="var(--series-2)"
                strokeWidth={2}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line type="stepAfter" dataKey="cents" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
            {selected && <ReferenceLine x={selected.date} stroke="var(--muted)" />}
            {selected && showBaseline && selected.baselineCents !== undefined && (
              <ReferenceDot x={selected.date} y={selected.baselineCents} r={4} fill="var(--series-2)" stroke="var(--surface)" strokeWidth={2} />
            )}
            {selected && (
              <ReferenceDot x={selected.date} y={selected.cents} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
            )}
            <ReferenceDot x={last.date} y={last.cents} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {showBaseline && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm">
          <LegendItem label={valueLabel} swatch="bg-series-1" />
          <LegendItem label={baselineLabel} swatch="bg-series-2" />
        </p>
      )}
      <details className="pt-2 text-sm">
        <summary className="min-h-10 cursor-pointer py-2 font-medium text-accent">Vedi i valori</summary>
        <table className="w-full tabular-nums">
          {showBaseline && (
            <thead>
              <tr className="text-right text-xs text-muted">
                <th className="pb-1 text-left font-medium">Data</th>
                <th className="pb-1 font-medium">{valueLabel}</th>
                <th className="pb-1 font-medium">{baselineLabel}</th>
              </tr>
            </thead>
          )}
          <tbody className="divide-y divide-line">
            {thinOut(points, TABLE_ROWS).map((point) => (
              <tr key={point.date}>
                <td className="py-1.5 text-muted">{formatFullDate(point.date)}</td>
                <td className="py-1.5 text-right">{formatCents(point.cents)}</td>
                {showBaseline && <td className="py-1.5 text-right">{formatCents(point.baselineCents ?? 0)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
