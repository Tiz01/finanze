import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { createHolding, deleteHolding, deleteSnapshot, recordPrices, updateHolding, type PriceUpdate } from '../db/investments';
import { computeBalances } from '../domain/balances';
import { formatFullDate, formatShortDate } from '../domain/dates';
import {
  activeHoldings,
  formatMicros,
  investmentSeries,
  parseMicros,
  portfolioTotals,
  positionValueCents,
  priceAgeLabel,
  snapshotsByHolding,
  summarizeHoldings,
  type HoldingSummary,
} from '../domain/investments';
import { formatCents, formatSignedCents, formatSignedRate } from '../domain/money';
import type { IsoDate } from '../domain/types';
import { routeHref } from '../router';
import { Button, ButtonLink, DateChip, Field, ListGroup, SectionTitle, SelectChip, SelectInput, TextInput } from '../ui/controls';
import { notify, notifyError } from '../ui/feedback';
import { openReconcile } from '../ui/reconcileStore';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { StatGrid, StatTile } from '../ui/stats';
import { useToday } from '../ui/useToday';
import { ValueChart } from '../ui/ValueChart';

const BACK = { href: routeHref('home'), label: 'Home' };
const ALL_INSTRUMENTS = '';

function gainText(gainCents: number, gainRate: number | null): string {
  return `${formatSignedCents(gainCents)}${gainRate === null ? '' : ` (${formatSignedRate(gainRate)})`}`;
}

function gainTone(gainCents: number): string {
  if (gainCents === 0) return 'text-muted';
  return gainCents < 0 ? 'text-danger' : 'text-positive';
}

function NumberInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <TextInput
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => event.target.select()}
      inputMode="decimal"
      enterKeyHint="done"
      autoComplete="off"
      className="tabular-nums"
    />
  );
}

function HoldingForm({
  holdingId,
  summary,
  today,
  onClose,
}: {
  holdingId: string | null;
  summary: HoldingSummary | undefined;
  today: IsoDate;
  onClose: () => void;
}) {
  const { accounts, holdings, holdingSnapshots } = useData();
  const holding = holdings.find(({ id }) => id === holdingId);

  const options = accounts
    .filter(({ archived, id, type }) => type === 'investimento' && (!archived || id === holding?.accountId))
    .map(({ id, name }) => ({ value: id, label: name }));

  const [instrument, setInstrument] = useState(holding?.instrument ?? '');
  const [isin, setIsin] = useState(holding?.isin ?? '');
  const [accountId, setAccountId] = useState(holding?.accountId ?? options[0]?.value ?? '');
  const [quantityText, setQuantityText] = useState(summary ? formatMicros(summary.quantityMicros) : '');
  const [avgText, setAvgText] = useState(summary ? formatMicros(summary.avgPriceMicros, 2) : '');
  const [priceText, setPriceText] = useState(summary ? formatMicros(summary.priceMicros, 2) : '');
  const [date, setDate] = useState(today);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const quantity = parseMicros(quantityText);
  const avg = parseMicros(avgText);
  const price = parseMicros(priceText);
  const history = holding ? [...(snapshotsByHolding(holdingSnapshots).get(holding.id) ?? [])].reverse() : [];

  async function save() {
    if (quantity === null) return setError('Scrivi le quote come numero, per esempio 12,5');
    if (avg === null) return setError('Scrivi il prezzo medio come numero, per esempio 150,25');
    if (price === null) return setError('Scrivi il prezzo attuale come numero, per esempio 168,39');

    const draft = { accountId, instrument, isin };
    const position = { date, quantityMicros: quantity, avgPriceMicros: avg, priceMicros: price };
    try {
      if (holding) {
        // Con gli stessi numeri e la data proposta sono cambiati solo nome, ISIN o conto.
        const unchanged =
          date === today && summary?.quantityMicros === quantity && summary.avgPriceMicros === avg && summary.priceMicros === price;
        await updateHolding(holding.id, draft, unchanged ? null : position, today);
      } else {
        await createHolding(draft, position, today);
      }
      notify(holding ? 'Strumento aggiornato' : 'Strumento aggiunto');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!holding) return;
    try {
      notify('Strumento eliminato', await deleteHolding(holding.id));
      onClose();
    } catch (problem) {
      notifyError(problem);
    }
  }

  async function removeUpdate(id: string) {
    try {
      notify('Aggiornamento eliminato', await deleteSnapshot(id));
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile eliminare');
    }
  }

  return (
    <Sheet title={holding ? holding.instrument : 'Nuovo strumento'} onClose={onClose} tall>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nome o codice">
            <TextInput value={instrument} onChange={(event) => setInstrument(event.target.value)} placeholder="Es. codice ETF" autoComplete="off" autoCapitalize="characters" />
          </Field>
          <Field label="ISIN (facoltativo)">
            <TextInput value={isin} onChange={(event) => setIsin(event.target.value)} autoComplete="off" autoCapitalize="characters" />
          </Field>
        </div>
        <Field label="Conto">
          <SelectInput value={accountId} onChange={setAccountId} options={options} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Quote">
            <NumberInput value={quantityText} onChange={setQuantityText} />
          </Field>
          <Field label="Prezzo medio (€)">
            <NumberInput value={avgText} onChange={setAvgText} />
          </Field>
          <Field label="Prezzo attuale (€)">
            <NumberInput value={priceText} onChange={setPriceText} />
          </Field>
          <Field label="Data">
            <TextInput
              type="date"
              value={date}
              max={today}
              onChange={(event) => {
                if (event.target.value) setDate(event.target.value);
              }}
            />
          </Field>
        </div>
        <p className="text-sm text-muted">
          Copia i numeri dal portafoglio del broker. Per un’obbligazione, le quote sono il nominale diviso 100.
        </p>
        {quantity !== null && avg !== null && price !== null && (
          <p className="rounded-xl bg-bg px-3 py-2 text-sm">
            Valore <span className="font-semibold tabular-nums">{formatCents(positionValueCents(quantity, price))}</span>
            {' · '}
            <span className={`font-medium tabular-nums ${gainTone(positionValueCents(quantity, price) - positionValueCents(quantity, avg))}`}>
              {formatSignedCents(positionValueCents(quantity, price) - positionValueCents(quantity, avg))}
            </span>
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {holding ? 'Salva' : 'Aggiungi strumento'}
        </Button>

        {history.length > 0 && (
          <div>
            <span className="mb-1 block text-sm font-medium text-muted">Aggiornamenti</span>
            <div className="divide-y divide-line overflow-hidden rounded-2xl bg-bg text-sm">
              {history.map((snapshot) => (
                <div key={snapshot.id} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block">{formatFullDate(snapshot.date)}</span>
                    <span className="block truncate text-xs text-muted tabular-nums">
                      {formatMicros(snapshot.quantityMicros)} quote · {formatMicros(snapshot.priceMicros, 2)} €
                    </span>
                  </span>
                  {history.length > 1 && (
                    <button type="button" onClick={() => void removeUpdate(snapshot.id)} className="min-h-10 shrink-0 px-1 font-medium text-danger">
                      Elimina
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {holding &&
          (confirmingDelete ? (
            <Button variant="danger" className="w-full" onClick={() => void remove()}>
              Conferma eliminazione
            </Button>
          ) : (
            <Button variant="dangerOutline" className="w-full" onClick={() => setConfirmingDelete(true)}>
              Elimina strumento
            </Button>
          ))}
      </div>
    </Sheet>
  );
}

function PricesForm({ summaries, today, onClose }: { summaries: HoldingSummary[]; today: IsoDate; onClose: () => void }) {
  const [date, setDate] = useState(today);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(summaries.map(({ holding, priceMicros }) => [holding.id, formatMicros(priceMicros, 2)])),
  );
  const [error, setError] = useState('');

  async function save() {
    const updates: PriceUpdate[] = [];
    for (const { holding, priceDate, priceMicros } of summaries) {
      const parsed = parseMicros(texts[holding.id] ?? '');
      if (parsed === null || parsed === 0) {
        setError(`Prezzo non valido per ${holding.instrument}`);
        return;
      }
      // Stesso prezzo con una data più recente: conferma che è ancora quello. Con una data passata è solo il valore proposto.
      if (parsed !== priceMicros || date > priceDate) updates.push({ holdingId: holding.id, priceMicros: parsed });
    }
    try {
      if (updates.length > 0) notify('Prezzi aggiornati', await recordPrices(date, updates, today));
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title="Aggiorna i prezzi" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Leggili nell’app del broker. Quote e prezzo medio restano quelli che hai già.</p>
        <DateChip label={formatShortDate(date, today)} ariaLabel="Data dei prezzi" value={date} onChange={setDate} />
        {summaries.map(({ holding, priceDate, priceMicros }) => (
          <Field
            key={holding.id}
            label={`${holding.instrument} (€)`}
            hint={`Ultimo: ${formatMicros(priceMicros, 2)} €, ${formatShortDate(priceDate, today).toLowerCase()}`}
          >
            <NumberInput value={texts[holding.id] ?? ''} onChange={(value) => setTexts((current) => ({ ...current, [holding.id]: value }))} />
          </Field>
        ))}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Salva i prezzi
        </Button>
      </div>
    </Sheet>
  );
}

function HoldingRow({ summary, onPress }: { summary: HoldingSummary; onPress: () => void }) {
  const { gainCents, gainRate, holding, priceMicros, quantityMicros, valueCents } = summary;
  return (
    <button type="button" onClick={onPress} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-bg">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{holding.instrument}</span>
        <span className="block truncate text-xs text-muted tabular-nums">
          {formatMicros(quantityMicros)} quote · {formatMicros(priceMicros, 2)} €
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block tabular-nums">{formatCents(valueCents)}</span>
        <span className={`block text-xs font-medium tabular-nums ${gainTone(gainCents)}`}>{gainText(gainCents, gainRate)}</span>
      </span>
    </button>
  );
}

export function Investimenti() {
  const { accounts, holdings, holdingSnapshots, transactions } = useData();
  const today = useToday();

  // `new` apre il modulo vuoto; altrimenti è lo strumento da modificare.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [chartInstrument, setChartInstrument] = useState(ALL_INSTRUMENTS);

  const investmentAccounts = accounts.filter(({ archived, type }) => type === 'investimento' && !archived);
  const active = useMemo(() => activeHoldings(holdings, accounts), [holdings, accounts]);
  const summaries = useMemo(() => summarizeHoldings(active, holdingSnapshots, today), [active, holdingSnapshots, today]);
  const totals = portfolioTotals(summaries);
  const balances = useMemo(() => computeBalances(accounts, transactions, today), [accounts, transactions, today]);

  const charted = active.find(({ id }) => id === chartInstrument);
  const series = useMemo(
    () => investmentSeries(charted ? [charted] : active, holdingSnapshots, today),
    [active, charted, holdingSnapshots, today],
  );

  if (investmentAccounts.length === 0) {
    return (
      <Screen title="Investimenti" back={BACK}>
        <section className="space-y-3 rounded-2xl bg-surface p-4">
          <h2 className="font-semibold">Per iniziare, crea il conto del tuo broker</h2>
          <p className="text-sm text-muted">In Conti scegli il tipo Investimento: non entrerà nella liquidità disponibile.</p>
          <ButtonLink href={routeHref('impostazioni/conti')}>Crea un conto</ButtonLink>
        </section>
      </Screen>
    );
  }

  const hero =
    summaries.length > 0 ? (
      <>
        <h1 className="text-sm font-medium text-muted">Investimenti</h1>
        <p className="text-5xl font-bold">{formatCents(totals.valueCents)}</p>
      </>
    ) : undefined;

  return (
    <Screen title="Investimenti" hero={hero} back={BACK}>
      {summaries.length > 0 && (
        <>
          <div className="rounded-2xl bg-surface">
            <StatGrid>
              <StatTile label="Costo di acquisto" value={formatCents(totals.costCents)} />
              <StatTile
                label="Guadagno o perdita"
                value={formatSignedCents(totals.gainCents)}
                hint={totals.gainRate === null ? undefined : formatSignedRate(totals.gainRate)}
                negative={totals.gainCents < 0}
              />
            </StatGrid>
            {totals.oldestPriceDate && (
              <p className="border-t border-line px-4 py-2 text-xs text-muted">
                Calcolati con i {priceAgeLabel(totals.oldestPriceDate, today)}: si aggiornano quando li inserisci tu.
              </p>
            )}
          </div>
          <Button className="mt-3 w-full" onClick={() => setUpdatingPrices(true)}>
            Aggiorna i prezzi
          </Button>
        </>
      )}

      {investmentAccounts.map((account) => {
        const rows = summaries.filter(({ holding }) => holding.accountId === account.id);
        return (
          <section key={account.id}>
            <div className="flex items-baseline justify-between gap-3 px-1 pt-4 pb-2 text-sm font-semibold text-muted">
              <h2 className="min-w-0 truncate">{account.name}</h2>
              {rows.length > 0 && <span className="shrink-0 tabular-nums">{formatCents(portfolioTotals(rows).valueCents)}</span>}
            </div>
            {rows.length > 0 ? (
              <ListGroup>
                {rows.map((summary) => (
                  <HoldingRow key={summary.holding.id} summary={summary} onPress={() => setEditing(summary.holding.id)} />
                ))}
              </ListGroup>
            ) : (
              <div className="rounded-2xl bg-surface px-4 py-3 text-sm">
                <p className="flex justify-between gap-3">
                  <span className="text-muted">Saldo dai movimenti</span>
                  <span className="tabular-nums">{formatCents(balances.get(account.id) ?? 0)}</span>
                </p>
                <p className="pt-1 text-muted">Nessuno strumento: aggiungine uno per seguirne il valore.</p>
                <button type="button" onClick={() => openReconcile(account.id, today)} className="mt-1 min-h-10 font-medium text-accent">
                  Aggiorna saldo reale
                </button>
              </div>
            )}
          </section>
        );
      })}

      <Button variant="secondary" className="mt-4 w-full" onClick={() => setEditing('new')}>
        Aggiungi strumento
      </Button>

      {summaries.length > 0 && (
        <>
          <SectionTitle>Andamento</SectionTitle>
          <div className="rounded-2xl bg-surface p-4">
            {active.length > 1 && (
              <div className="pb-3">
                <SelectChip
                  label={charted?.instrument ?? 'Tutti gli strumenti'}
                  ariaLabel="Scegli lo strumento"
                  value={charted?.id ?? ALL_INSTRUMENTS}
                  onChange={setChartInstrument}
                  active={charted !== undefined}
                  options={[
                    { value: ALL_INSTRUMENTS, label: 'Tutti gli strumenti' },
                    ...active.map(({ id, instrument }) => ({ value: id, label: instrument })),
                  ]}
                />
              </div>
            )}
            {series.length >= 2 ? (
              <ValueChart points={series} today={today} baselineLabel="Costo di acquisto" />
            ) : (
              <p className="text-sm text-muted">La linea compare da domani: ogni aggiornamento dei prezzi aggiunge un pezzo di storia.</p>
            )}
          </div>
        </>
      )}

      {editing !== null && (
        <HoldingForm
          key={editing}
          holdingId={editing === 'new' ? null : editing}
          summary={summaries.find(({ holding }) => holding.id === editing)}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
      {updatingPrices && <PricesForm summaries={summaries} today={today} onClose={() => setUpdatingPrices(false)} />}
    </Screen>
  );
}
