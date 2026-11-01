import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { createHolding, deleteHolding, deleteSnapshot, recordPrices, setAccountCash, updateHolding, type PriceUpdate } from '../db/investments';
import { computeBalances } from '../domain/balances';
import { daysBetween, formatFullDate, formatShortDate } from '../domain/dates';
import {
  accountOverviews,
  activeHoldings,
  formatMicros,
  hasPosition,
  investmentSeries,
  overviewTotals,
  parseMicros,
  portfolioTotals,
  positionValueCents,
  priceAgeLabel,
  snapshotAt,
  snapshotsByHolding,
  summarizeHoldings,
  type AccountOverview,
  type HoldingSummary,
} from '../domain/investments';
import {
  applyKeypadKey,
  centsToKeypadInput,
  formatCents,
  formatKeypadInput,
  formatRate,
  formatSignedCents,
  formatSignedRate,
  keypadInputToCents,
} from '../domain/money';
import { isIsin, isSearchable, normalizeCode } from '../domain/quotes';
import type { Account, IsoDate } from '../domain/types';
import { usePriceSyncState, useInstrumentLookup, type InstrumentLookup, type PriceSyncState } from '../quotes';
import { routeHref } from '../router';
import { Button, ButtonLink, DateChip, Field, ListGroup, SectionTitle, SelectChip, SelectInput, TextInput } from '../ui/controls';
import { DonutChart } from '../ui/DonutChart';
import { notify, notifyError } from '../ui/feedback';
import { Keypad } from '../ui/Keypad';
import { Screen } from '../ui/Screen';
import { Sheet } from '../ui/Sheet';
import { StatGrid, StatTile } from '../ui/stats';
import { useToday } from '../ui/useToday';
import { ValueChart } from '../ui/ValueChart';

const ALL_INSTRUMENTS = '';
// Oltre questi giorni non è un fine settimana o una festa: il prezzo si è proprio fermato.
const STALE_PRICE_DAYS = 7;
// Un grafico più corto di così si può ancora riempire indicando la data di acquisto.
const SHORT_HISTORY_DAYS = 7;
const MAX_HISTORY_ROWS = 60;

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

function LookupStatus({
  lookup,
  code,
  hasText,
  keptPrice,
  today,
}: {
  lookup: InstrumentLookup;
  code: string;
  hasText: boolean;
  /** L'ultimo prezzo di uno strumento già collegato, se adesso non si riesce a leggerlo. */
  keptPrice: number | null;
  today: IsoDate;
}) {
  if (lookup.status === 'found') {
    const { match, quote } = lookup;
    return (
      <div className="rounded-xl bg-bg px-3 py-2 text-sm" aria-live="polite">
        <p className="font-medium">{match.name}</p>
        <p className="text-muted tabular-nums">
          {formatMicros(quote.priceMicros, 2)} € · {quote.market} · {formatShortDate(quote.date, today).toLowerCase()}. Si aggiorna da solo.
        </p>
      </div>
    );
  }

  let text = 'Scrivi il codice o l’ISIN dello strumento: il prezzo arriva da solo.';
  if (lookup.status === 'searching') text = 'Cerco il prezzo…';
  if (lookup.status === 'idle' && hasText) text = 'Per il prezzo automatico serve il codice o l’ISIN. Altrimenti scrivi il prezzo qui sotto.';
  if (lookup.status === 'notFound') {
    text = isIsin(code)
      ? 'Nessun prezzo in euro per questo ISIN: scrivilo qui sotto.'
      : `Nessun prezzo per «${code}». Prova con l’ISIN, che trovi nell’app del broker, oppure scrivilo qui sotto.`;
  }
  if (lookup.status === 'failed') {
    text =
      keptPrice === null
        ? 'Non riesco a cercare il prezzo adesso: controlla la rete, oppure scrivilo qui sotto.'
        : `Non riesco a leggere il prezzo adesso: resta l’ultimo, ${formatMicros(keptPrice, 2)} €.`;
  }
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {text}
    </p>
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

  const code = normalizeCode(isin) || normalizeCode(instrument);
  const lookup = useInstrumentLookup(code);

  // Uno strumento già collegato resta automatico anche se in questo momento manca la rete.
  const keepLink =
    holding?.quoteSource !== undefined &&
    summary !== undefined &&
    code === normalizeCode(holding.isin || holding.instrument) &&
    (lookup.status === 'failed' || lookup.status === 'searching');
  const automatic =
    lookup.status === 'found'
      ? { source: lookup.match.source, isin: lookup.match.isin, name: lookup.match.name, priceMicros: lookup.quote.priceMicros }
      : keepLink
        ? { source: holding.quoteSource as string, isin: holding.isin, name: holding.instrument, priceMicros: summary.priceMicros }
        : null;
  const waiting = lookup.status === 'searching' && !automatic && !holding;
  const hasText = code !== '';
  const showManual = !automatic && !waiting && hasText;

  const quantity = parseMicros(quantityText);
  const avg = parseMicros(avgText);
  const price = automatic ? automatic.priceMicros : parseMicros(priceText);

  const rows = useMemo(
    () => (holding ? (snapshotsByHolding(holdingSnapshots).get(holding.id) ?? []) : []),
    [holding, holdingSnapshots],
  );
  const positionCount = rows.filter(hasPosition).length;
  // Nei prezzi automatici ogni giorno ha la sua riga: qui contano solo quote e prezzo di acquisto.
  const history = [...rows].reverse().filter((row) => !automatic || hasPosition(row));

  async function save() {
    if (!hasText) return setError('Scrivi il codice o il nome dello strumento');
    if (waiting) return setError('Aspetta un attimo: sto cercando il prezzo');
    if (quantity === null) return setError('Scrivi le quote come numero, per esempio 12,5');
    if (avg === null) return setError('Scrivi il prezzo di acquisto come numero, per esempio 150,25');
    if (price === null) return setError('Scrivi il prezzo attuale come numero, per esempio 168,39');

    const draft = {
      accountId,
      // I codici in maiuscolo, come li mostra il broker.
      instrument: isSearchable(normalizeCode(instrument)) ? normalizeCode(instrument) : instrument.trim() || automatic?.name || isin,
      isin: isin.trim() || automatic?.isin || '',
      ...(automatic ? { quoteSource: automatic.source } : {}),
    };
    // In una data passata vale il prezzo di allora, se è già noto: poi arrivano le chiusure vere.
    const priceThen = snapshotAt(rows, date)?.priceMicros ?? (avg > 0 ? avg : price);
    const priceMicros = automatic && date !== today ? priceThen : price;
    const position = { date, quantityMicros: quantity, avgPriceMicros: avg, priceMicros };
    try {
      if (holding) {
        // Con gli stessi numeri e la data proposta sono cambiati solo nome, ISIN o conto.
        const samePosition = summary?.quantityMicros === quantity && summary.avgPriceMicros === avg;
        const unchanged = date === today && samePosition && (automatic !== null || summary?.priceMicros === price);
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
          <Field label="ISIN">
            <TextInput value={isin} onChange={(event) => setIsin(event.target.value)} autoComplete="off" autoCapitalize="characters" />
          </Field>
        </div>
        <LookupStatus lookup={lookup} code={code} hasText={hasText} keptPrice={keepLink ? summary.priceMicros : null} today={today} />
        <Field label="Conto">
          <SelectInput value={accountId} onChange={setAccountId} options={options} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Quote">
            <NumberInput value={quantityText} onChange={setQuantityText} />
          </Field>
          <Field label="Prezzo di acquisto (€)">
            <NumberInput value={avgText} onChange={setAvgText} />
          </Field>
          {showManual && (
            <Field label="Prezzo attuale (€)">
              <NumberInput value={priceText} onChange={setPriceText} />
            </Field>
          )}
          <Field label={showManual ? 'Data' : 'Data di acquisto'}>
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
          {!showManual && 'Da quella data il grafico conta queste quote con i prezzi di allora. '}
          Se hai comprato a più riprese, puoi salvare più date, ogni volta con le quote totali e il prezzo medio di carico di quel momento.
          Per un’obbligazione, le quote sono il nominale diviso 100.
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
              {history.slice(0, MAX_HISTORY_ROWS).map((row) => (
                <div key={row.id} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block">{formatFullDate(row.date)}</span>
                    <span className="block truncate text-xs text-muted tabular-nums">
                      {hasPosition(row)
                        ? `${formatMicros(row.quantityMicros)} quote · acquisto ${formatMicros(row.avgPriceMicros, 2)} €${automatic ? '' : ` · ora ${formatMicros(row.priceMicros, 2)} €`}`
                        : `Prezzo ${formatMicros(row.priceMicros, 2)} €`}
                    </span>
                  </span>
                  {(!hasPosition(row) || positionCount > 1) && (
                    <button type="button" onClick={() => void removeUpdate(row.id)} className="min-h-10 shrink-0 px-1 font-medium text-danger">
                      Elimina
                    </button>
                  )}
                </div>
              ))}
              {history.length > MAX_HISTORY_ROWS && (
                <p className="px-3 py-2 text-xs text-muted">E altri {history.length - MAX_HISTORY_ROWS} più vecchi.</p>
              )}
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
        <p className="text-sm text-muted">Leggili nell’app del broker. Quote e prezzo di acquisto restano quelli che hai già.</p>
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

function CashForm({ account, today, onClose }: { account: Account; today: IsoDate; onClose: () => void }) {
  const [input, setInput] = useState(account.cashCents === undefined ? '' : centsToKeypadInput(account.cashCents));
  const [error, setError] = useState('');

  async function save() {
    try {
      notify('Liquidità aggiornata', await setAccountCash(account.id, keypadInputToCents(input), today));
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title={`Liquidità di ${account.name}`} onClose={onClose}>
      <p className="text-center text-sm text-muted">Scrivi i soldi non investiti che vedi nel broker.</p>
      <p className={`py-3 text-center text-4xl font-semibold ${input === '' ? 'opacity-40' : ''}`}>{formatKeypadInput(input)}&nbsp;€</p>
      <div className="space-y-3">
        <Keypad
          onKey={(key) => {
            setError('');
            setInput((current) => applyKeypadKey(current, key));
          }}
        />
        {error && (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={input === ''} onClick={() => void save()}>
          Salva
        </Button>
        <p className="text-center text-xs text-muted">Restano fuori dalla liquidità disponibile della Home.</p>
      </div>
    </Sheet>
  );
}

function OverviewValue({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        <span className={`size-2.5 shrink-0 rounded-[2px] ${swatch}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

function CashRow({ overview, today, onPress }: { overview: AccountOverview; today: IsoDate; onPress: () => void }) {
  const { account, cashCents } = overview;
  let detail = 'I soldi non investiti';
  if (account.cashDate) detail = `Aggiornata ${formatShortDate(account.cashDate, today).toLowerCase()}`;
  else if (cashCents !== null) detail = 'Dai movimenti del conto';
  return (
    <button type="button" onClick={onPress} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-bg">
      <span className="min-w-0 flex-1">
        <span className="block truncate">Liquidità</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {cashCents === null ? (
        <span className="shrink-0 font-medium text-accent">Aggiungi</span>
      ) : (
        <span className="shrink-0 tabular-nums">{formatCents(cashCents)}</span>
      )}
    </button>
  );
}

function PriceNote({ summaries, syncState, today }: { summaries: HoldingSummary[]; syncState: PriceSyncState; today: IsoDate }) {
  const automatic = summaries.filter(({ holding }) => holding.quoteSource);
  const manualCount = summaries.length - automatic.length;
  const oldest = portfolioTotals(automatic.length > 0 ? automatic : summaries).oldestPriceDate ?? today;
  const age = priceAgeLabel(oldest, today);

  let text = `Calcolati con i ${age}: si aggiornano quando li inserisci tu.`;
  if (automatic.length > 0) {
    const others = manualCount === 0 ? '' : manualCount === 1 ? ' Uno strumento lo aggiorni tu.' : ` ${manualCount} strumenti li aggiorni tu.`;
    if (syncState === 'failed') text = `Non riesco a leggere i prezzi automatici: restano i ${age}.${others}`;
    else if (daysBetween(oldest, today) > STALE_PRICE_DAYS) text = `Dai prezzi automatici non arriva niente di più recente: restano i ${age}.${others}`;
    else text = `Prezzi automatici da onvista, con qualche minuto di ritardo.${others}`;
  }
  return <p className="border-t border-line px-4 py-2 text-xs text-muted">{text}</p>;
}

function HoldingRow({ summary, onPress }: { summary: HoldingSummary; onPress: () => void }) {
  const { gainCents, gainRate, holding, priceMicros, quantityMicros, valueCents } = summary;
  return (
    <button type="button" onClick={onPress} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-bg">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{holding.instrument}</span>
        <span className="block truncate text-xs text-muted tabular-nums">
          {formatMicros(quantityMicros)} quote · {formatMicros(priceMicros, 2)} €{holding.quoteSource ? '' : ' · a mano'}
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
  const syncState = usePriceSyncState();

  // `new` apre il modulo vuoto; altrimenti è lo strumento da modificare.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [editingCash, setEditingCash] = useState<string | null>(null);
  const [chartInstrument, setChartInstrument] = useState(ALL_INSTRUMENTS);

  const active = useMemo(() => activeHoldings(holdings, accounts), [holdings, accounts]);
  const summaries = useMemo(() => summarizeHoldings(active, holdingSnapshots, today), [active, holdingSnapshots, today]);
  const totals = portfolioTotals(summaries);
  const balances = useMemo(() => computeBalances(accounts, transactions, today), [accounts, transactions, today]);
  const overviews = useMemo(() => accountOverviews(accounts, summaries, balances), [accounts, summaries, balances]);
  const overall = overviewTotals(overviews);

  const charted = active.find(({ id }) => id === chartInstrument);
  const series = useMemo(
    () => investmentSeries(charted ? [charted] : active, holdingSnapshots, today),
    [active, charted, holdingSnapshots, today],
  );

  if (overviews.length === 0) {
    return (
      <Screen title="Investimenti">
        <section className="space-y-3 rounded-2xl bg-surface p-4">
          <h2 className="font-semibold">Per iniziare, crea il conto del tuo broker</h2>
          <p className="text-sm text-muted">In Conti scegli il tipo Investimento: non entrerà nella liquidità disponibile.</p>
          <ButtonLink href={routeHref('impostazioni/conti')}>Crea un conto</ButtonLink>
        </section>
      </Screen>
    );
  }

  // A mano si aggiornano quelli senza prezzo automatico, e tutti se la lettura automatica non funziona.
  const manual = syncState === 'failed' ? summaries : summaries.filter(({ holding }) => !holding.quoteSource);
  const hasAutomatic = summaries.some(({ holding }) => holding.quoteSource);
  const firstChartDate = series[0]?.date ?? today;

  const showOverview = summaries.length > 0 || overall.cashCents !== 0;
  const noCashKnown = overall.missingCash === overviews.length;
  const accountWithCashOpen = overviews.find(({ account }) => account.id === editingCash)?.account;

  const hero = showOverview ? (
    <>
      <h1 className="text-sm font-medium text-muted">Totale dei conti investimento</h1>
      <p className="text-5xl font-bold">{formatCents(overall.totalCents)}</p>
    </>
  ) : undefined;

  return (
    <Screen title="Investimenti" hero={hero}>
      {showOverview && (
        <>
          <div className="rounded-2xl bg-surface">
            <div className="flex items-center gap-4 p-4">
              <DonutChart
                segments={[
                  { label: 'Investito', cents: overall.investedCents, color: 'var(--series-1)' },
                  { label: 'Liquidità', cents: overall.cashCents, color: 'var(--series-3)' },
                ]}
              >
                {/* Finché nessun conto ha la liquidità, «100% investito» sarebbe un numero inventato. */}
                {overall.investedShare !== null && !noCashKnown && (
                  <>
                    <span className="text-lg leading-tight font-bold">{formatRate(overall.investedShare)}</span>
                    <span className="text-[11px] leading-tight text-muted">investito</span>
                  </>
                )}
              </DonutChart>
              <dl className="min-w-0 flex-1 space-y-2">
                <OverviewValue swatch="bg-series-1" label="Investito" value={formatCents(overall.investedCents)} />
                <OverviewValue
                  swatch="bg-series-3"
                  label="Liquidità"
                  value={noCashKnown ? 'Da aggiungere' : formatCents(overall.cashCents)}
                />
              </dl>
            </div>
            {overall.missingCash > 0 && (
              <p className="px-4 pb-3 text-xs text-muted">
                {overall.missingCash === 1 ? 'Manca la liquidità di un conto' : `Manca la liquidità di ${overall.missingCash} conti`}: la aggiungi qui sotto.
              </p>
            )}
            {summaries.length > 0 && (
              <>
                <div className="border-t border-line">
                  <StatGrid>
                    <StatTile label="Costo di acquisto" value={formatCents(totals.costCents)} />
                    <StatTile
                      label="Guadagno o perdita"
                      value={formatSignedCents(totals.gainCents)}
                      hint={totals.gainRate === null ? undefined : formatSignedRate(totals.gainRate)}
                      negative={totals.gainCents < 0}
                    />
                  </StatGrid>
                </div>
                <PriceNote summaries={summaries} syncState={syncState} today={today} />
              </>
            )}
          </div>
          {manual.length > 0 && (
            <Button className="mt-3 w-full" onClick={() => setUpdatingPrices(true)}>
              Aggiorna i prezzi
            </Button>
          )}
        </>
      )}

      {overviews.map((overview) => {
        const { account, cashCents, holdings: rows, investedCents, totalCents } = overview;
        return (
          <section key={account.id}>
            <div className="px-1 pt-4 pb-2">
              <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-muted">
                <h2 className="min-w-0 truncate">{account.name}</h2>
                <span className="shrink-0 tabular-nums">{formatCents(totalCents)}</span>
              </div>
              <p className="text-xs text-muted tabular-nums">
                Investito {formatCents(investedCents)} · Liquidità {cashCents === null ? 'da aggiungere' : formatCents(cashCents)}
              </p>
            </div>
            <ListGroup>
              {rows.map((summary) => (
                <HoldingRow key={summary.holding.id} summary={summary} onPress={() => setEditing(summary.holding.id)} />
              ))}
              <CashRow overview={overview} today={today} onPress={() => setEditingCash(account.id)} />
            </ListGroup>
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
            {series.length >= 2 && <ValueChart points={series} today={today} baselineLabel="Costo di acquisto" />}
            {series.length < 2 && !hasAutomatic && (
              <p className="text-sm text-muted">La linea compare da domani: ogni aggiornamento dei prezzi aggiunge un pezzo di storia.</p>
            )}
            {hasAutomatic && daysBetween(firstChartDate, today) < SHORT_HISTORY_DAYS && (
              <p className="text-sm text-muted">Per riempire il grafico, tocca uno strumento e indica la data di acquisto.</p>
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
      {updatingPrices && <PricesForm summaries={manual} today={today} onClose={() => setUpdatingPrices(false)} />}
      {accountWithCashOpen && <CashForm key={accountWithCashOpen.id} account={accountWithCashOpen} today={today} onClose={() => setEditingCash(null)} />}
    </Screen>
  );
}
