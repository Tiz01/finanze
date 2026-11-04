import { useState } from 'react';
import { createAccount } from '../db/accounts';
import { useData } from '../db/DataProvider';
import { confirmAllInterest, confirmInterest, setAccountInterest, skipInterest } from '../db/interest';
import { computeBalances } from '../domain/balances';
import { formatFullDate, formatShortDate } from '../domain/dates';
import {
  interestFormValues,
  interestTermsLabel,
  parseInterestForm,
  type InterestCredit,
  type InterestOverview,
} from '../domain/interest';
import {
  applyKeypadKey,
  formatCents,
  formatKeypadInput,
  keypadInputToCents,
} from '../domain/money';
import type { IsoDate } from '../domain/types';
import { AmountField } from './AmountField';
import { Button, ButtonRow, DateChip, Field, ListGroup, SelectInput, TextInput, ToggleRow } from './controls';
import { openNewTransfer } from './entryStore';
import { notify, notifyError } from './feedback';
import { InterestFields } from './InterestFields';
import { Keypad } from './Keypad';
import { openReconcile } from './reconcileStore';
import { Sheet } from './Sheet';
import { StatGrid, StatTile } from './stats';

const NEW_ACCOUNT = '';

/** Un conto nuovo, oppure uno già presente in Conti che comincia a rendere. */
export function NewInterestAccountForm({ today, onClose }: { today: IsoDate; onClose: () => void }) {
  const { accounts, transactions } = useData();
  const convertible = accounts.filter(({ archived, type }) => !archived && type !== 'investimento' && type !== 'remunerato');

  const [accountId, setAccountId] = useState(NEW_ACCOUNT);
  const [name, setName] = useState('');
  const [newCents, setNewCents] = useState(0);
  const [liquidity, setLiquidity] = useState(false);
  const [values, setValues] = useState(() => interestFormValues(undefined, today));
  const [error, setError] = useState('');

  const existing = convertible.find(({ id }) => id === accountId);
  const balanceCents = existing ? (computeBalances([existing], transactions, today).get(existing.id) ?? 0) : newCents;

  function chooseAccount(next: string) {
    setAccountId(next);
    setLiquidity(convertible.find(({ id }) => id === next)?.contaComeLiquidita ?? false);
  }

  async function save() {
    const { error: problem, terms } = parseInterestForm(values);
    if (!terms) return setError(problem);
    try {
      if (existing) {
        await setAccountInterest(existing.id, terms, { contaComeLiquidita: liquidity });
      } else {
        await createAccount({
          name,
          type: 'remunerato',
          currency: 'EUR',
          initialBalanceCents: newCents,
          initialBalanceDate: terms.startDate,
          archived: false,
          contaComeLiquidita: liquidity,
          interest: terms,
        });
      }
      notify('Conto remunerato pronto');
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title="Conto remunerato" onClose={onClose} tall>
      <div className="space-y-3">
        {convertible.length > 0 && (
          <Field label="Quale conto">
            <SelectInput
              value={accountId}
              onChange={chooseAccount}
              options={[
                { value: NEW_ACCOUNT, label: 'Nuovo conto' },
                ...convertible.map(({ id, name: accountName }) => ({ value: id, label: accountName })),
              ]}
            />
          </Field>
        )}
        {existing ? (
          <p className="text-sm text-muted">
            Saldo di oggi: <span className="font-semibold text-ink tabular-nums">{formatCents(balanceCents)}</span>. Saldo e movimenti restano quelli che hai.
          </p>
        ) : (
          <>
            <Field label="Nome">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" placeholder="Es. il nome della banca" />
            </Field>
            <Field label="Somma di partenza" hint="Quella che c’è sul conto nella data «Da quando».">
              <AmountField title="Somma di partenza" cents={newCents} onChange={setNewCents} />
            </Field>
          </>
        )}
        <InterestFields values={values} onChange={setValues} balanceCents={balanceCents} />
        <ToggleRow label="Conta come liquidità" hint="Entra anche nei soldi disponibili in Home." checked={liquidity} onChange={setLiquidity} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Salva
        </Button>
      </div>
    </Sheet>
  );
}

function TermsForm({ overview, onClose }: { overview: InterestOverview; onClose: () => void }) {
  const { account, balanceCents } = overview;
  const [values, setValues] = useState(() => interestFormValues(account.interest, account.initialBalanceDate));
  const [error, setError] = useState('');

  async function save() {
    const { error: problem, terms } = parseInterestForm(values);
    if (!terms) return setError(problem);
    try {
      await setAccountInterest(account.id, terms, { contaComeLiquidita: account.contaComeLiquidita });
      notify('Condizioni aggiornate');
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title={`Condizioni di ${account.name}`} onClose={onClose} tall>
      <div className="space-y-3">
        <InterestFields values={values} onChange={setValues} balanceCents={balanceCents} />
        <p className="text-sm text-muted">Gli interessi già registrati restano come sono: le nuove condizioni valgono dal prossimo accredito.</p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          Salva
        </Button>
      </div>
    </Sheet>
  );
}

function CreditForm({
  accountId,
  credit,
  today,
  onClose,
}: {
  accountId: string;
  credit: InterestCredit;
  today: IsoDate;
  onClose: () => void;
}) {
  // Vuoto: con la stima già scritta, le cifre digitate dopo i due decimali verrebbero ignorate.
  const [input, setInput] = useState('');
  const [date, setDate] = useState(credit.date);
  const [error, setError] = useState('');
  const amountCents = keypadInputToCents(input);

  async function save() {
    try {
      notify('Interessi registrati', await confirmInterest(accountId, today, { date, amountCents }));
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Non è stato possibile salvare');
    }
  }

  return (
    <Sheet title="Interessi accreditati" onClose={onClose}>
      <p className="text-center text-sm text-muted">
        Scrivi quello che ha accreditato la banca, al netto delle tasse. La stima dell’app è {formatCents(credit.netCents)}.
      </p>
      <p className={`py-3 text-center text-4xl font-semibold ${input === '' ? 'opacity-40' : ''}`}>{formatKeypadInput(input)}&nbsp;€</p>
      <div className="pb-2">
        <DateChip label={formatShortDate(date, today)} ariaLabel="Data dell’accredito" value={date} onChange={setDate} />
      </div>
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
        <Button className="w-full" disabled={amountCents <= 0} onClick={() => void save()}>
          Salva
        </Button>
      </div>
    </Sheet>
  );
}

const SMALL_BUTTON = 'min-h-11 rounded-xl px-2 text-sm font-semibold active:opacity-80';

function PendingCredits({ accountId, pending, today }: { accountId: string; pending: InterestCredit[]; today: IsoDate }) {
  const [correcting, setCorrecting] = useState(false);
  const first = pending[0];
  if (!first) return null;
  const others = pending.length - 1;
  const totalCents = pending.reduce((sum, { netCents }) => sum + netCents, 0);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Interessi da confermare</span>
          <span className="block text-xs text-muted">
            {formatFullDate(first.date)}
            {others > 0 && (others === 1 ? ' e un altro accredito' : ` e altri ${others} accrediti`)}
          </span>
        </span>
        <span className="shrink-0 font-medium text-positive tabular-nums">+{formatCents(first.netCents)}</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            confirmInterest(accountId, today).then((undo) => notify('Interessi registrati', undo), notifyError);
          }}
          className={`${SMALL_BUTTON} bg-accent text-on-accent`}
        >
          Conferma
        </button>
        <button type="button" onClick={() => setCorrecting(true)} className={`${SMALL_BUTTON} border border-line`}>
          Modifica
        </button>
        <button
          type="button"
          onClick={() => {
            skipInterest(accountId, today).then((undo) => notify('Accredito saltato', undo), notifyError);
          }}
          className={`${SMALL_BUTTON} border border-line`}
        >
          Salta
        </button>
      </div>
      {others > 0 && (
        <button
          type="button"
          onClick={() => {
            confirmAllInterest(accountId, today).then((undo) => notify('Interessi registrati', undo), notifyError);
          }}
          className={`${SMALL_BUTTON} mt-2 w-full border border-line`}
        >
          Conferma tutti: +{formatCents(totalCents)}
        </button>
      )}
      {correcting && <CreditForm key={first.date} accountId={accountId} credit={first} today={today} onClose={() => setCorrecting(false)} />}
    </div>
  );
}

export function InterestAccountSection({ overview, today }: { overview: InterestOverview; today: IsoDate }) {
  const { account, balanceCents, receivedCents, status } = overview;
  const [editing, setEditing] = useState(false);
  const { accruedNetCents, endDate, finished, next, pending, projection } = status;

  return (
    <section>
      <div className="px-1 pt-4 pb-2">
        <div className="flex items-baseline justify-between gap-3 text-sm font-semibold text-muted">
          <h2 className="min-w-0 truncate">{account.name}</h2>
          <span className="shrink-0 tabular-nums">{formatCents(balanceCents)}</span>
        </div>
        {account.interest && <p className="text-xs text-muted">{interestTermsLabel(account.interest)}</p>}
      </div>
      <ListGroup>
        <PendingCredits accountId={account.id} pending={pending} today={today} />
        <StatGrid>
          <StatTile label="Interessi ricevuti" value={formatCents(receivedCents)} />
          {next && (
            <StatTile label="Maturati finora" value={formatCents(accruedNetCents)} hint={`Netti, arrivano il ${formatFullDate(next.date)}`} />
          )}
          {next && <StatTile label="Prossimo accredito" value={`+${formatCents(next.netCents)}`} hint={`Stima, ${formatFullDate(next.date)}`} />}
          {projection && (
            <StatTile
              label={endDate ? 'A fine periodo' : 'Tra 12 mesi'}
              value={formatCents(projection.balanceCents)}
              hint={`+${formatCents(projection.interestNetCents)} di interessi`}
            />
          )}
        </StatGrid>
        {finished && endDate && (
          <p className="px-4 py-3 text-sm text-muted">
            Il periodo è finito il {formatFullDate(endDate)}: gli interessi non si calcolano più. Per continuare, cambia le condizioni.
          </p>
        )}
        <ButtonRow onClick={() => setEditing(true)} detail="Cambia">
          Condizioni
        </ButtonRow>
        {pending.length === 0 && (
          <ButtonRow onClick={() => openReconcile(account.id, today)} detail="Aggiorna">
            Saldo reale della banca
          </ButtonRow>
        )}
      </ListGroup>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => openNewTransfer({ toAccountId: account.id })}>
          Aggiungi soldi
        </Button>
        <Button variant="secondary" onClick={() => openNewTransfer({ accountId: account.id })}>
          Togli soldi
        </Button>
      </div>
      {editing && <TermsForm overview={overview} onClose={() => setEditing(false)} />}
    </section>
  );
}
