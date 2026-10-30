import { useMemo, useState } from 'react';
import { useData } from '../db/DataProvider';
import { reconcileAccount } from '../db/reconciliations';
import { computeBalances } from '../domain/balances';
import { formatShortDate, todayIso } from '../domain/dates';
import {
  applyKeypadKey,
  centsToKeypadInput,
  formatCents,
  formatKeypadInput,
  formatSignedCents,
  keypadInputToCents,
} from '../domain/money';
import type { Account } from '../domain/types';
import { routeHref } from '../router';
import { Button, DateChip } from './controls';
import { notify } from './feedback';
import { Keypad } from './Keypad';
import { closeReconcile, reconcileStore, type ReconcileRequest } from './reconcileStore';
import { Sheet } from './Sheet';
import { useStore } from './store';

export function ReconcileSheet() {
  const request = useStore(reconcileStore);
  const { accounts } = useData();
  if (!request?.open) return null;
  const account = accounts.find((item) => item.id === request.accountId);
  if (!account) return null;
  return <ReconcileForm key={account.id} account={account} request={request} />;
}

function ReconcileForm({ account, request }: { account: Account; request: ReconcileRequest }) {
  const { transactions } = useData();
  const today = todayIso();
  const known = request.realBalanceCents;

  const [input, setInput] = useState(known === null ? '' : centsToKeypadInput(known));
  const [negative, setNegative] = useState((known ?? 0) < 0);
  const [date, setDate] = useState(request.date);
  const [step, setStep] = useState<'amount' | 'difference'>(known === null ? 'amount' : 'difference');
  const [error, setError] = useState('');

  const computed = useMemo(
    () => computeBalances([account], transactions, date).get(account.id) ?? 0,
    [account, transactions, date],
  );
  const real = (negative ? -1 : 1) * keypadInputToCents(input);
  const difference = real - computed;
  const isInvestment = account.type === 'investimento';

  async function save(createAdjustment: boolean) {
    try {
      const undo = await reconcileAccount({
        accountId: account.id,
        date,
        realBalanceCents: real,
        createAdjustment,
      });
      closeReconcile();
      notify(createAdjustment ? 'Saldo aggiornato con una rettifica' : 'Saldo verificato: coincide', undo);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  function proceed() {
    setError('');
    if (date > today) {
      setError('La data non può essere futura');
    } else if (date < account.initialBalanceDate) {
      setError('La data è precedente al saldo iniziale del conto');
    } else if (difference === 0) {
      void save(false);
    } else {
      setStep('difference');
    }
  }

  function searchMissingMovement() {
    reconcileStore.set({ ...request, date, realBalanceCents: real, open: false });
    window.location.hash = routeHref('movimenti');
  }

  if (step === 'amount') {
    return (
      <Sheet title={`Saldo reale di ${account.name}`} onClose={closeReconcile}>
        <p className="text-center text-sm text-muted">
          {isInvestment ? 'Inserisci il valore che vedi nell’app del broker.' : 'Inserisci il saldo che vedi nell’app della banca.'}
        </p>
        <p className={`py-3 text-center text-4xl font-semibold ${input === '' ? 'opacity-40' : ''}`}>
          {negative ? '−' : ''}
          {formatKeypadInput(input)}&nbsp;€
        </p>
        <div className="flex items-center justify-between gap-2 pb-2">
          <DateChip label={formatShortDate(date, today)} ariaLabel="Data del saldo" value={date} onChange={setDate} />
          <button
            type="button"
            onClick={() => setNegative((value) => !value)}
            className="min-h-10 rounded-full border border-line px-3 text-sm"
          >
            Cambia segno
          </button>
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
          <Button className="w-full" disabled={input === ''} onClick={proceed}>
            Continua
          </Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Saldo reale di ${account.name}`} onClose={closeReconcile}>
      <div className="space-y-3">
        <dl className="divide-y divide-line rounded-2xl bg-bg tabular-nums">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt>{isInvestment ? 'Valore reale' : 'In banca'}</dt>
            <dd>{formatCents(real)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt>Nell’app</dt>
            <dd>{formatCents(computed)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 font-semibold">
            <dt>Differenza</dt>
            <dd>{formatSignedCents(difference)}</dd>
          </div>
        </dl>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {difference === 0 ? (
          <>
            <p className="text-sm text-muted">Ora il saldo dell’app coincide con quello della banca.</p>
            <Button className="w-full" onClick={() => void save(false)}>
              Segna come verificato
            </Button>
          </>
        ) : isInvestment ? (
          <>
            <p className="text-sm text-muted">
              Di solito questa differenza è l’andamento del mercato: la registro come variazione, fuori dal risparmio.
            </p>
            <Button className="w-full" onClick={() => void save(true)}>
              Registra variazione di {formatSignedCents(difference)}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {difference < 0
                ? `In banca ci sono ${formatCents(-difference)} in meno: forse una spesa non registrata.`
                : `In banca ci sono ${formatCents(difference)} in più: forse un’entrata non registrata.`}
            </p>
            <Button className="w-full" onClick={() => void save(true)}>
              Crea rettifica di {formatSignedCents(difference)}
            </Button>
            <p className="text-xs text-muted">
              Registra la differenza come “Non tracciato”: nei report vedrai quanto si perde per strada.
            </p>
            <Button variant="secondary" className="w-full" onClick={searchMissingMovement}>
              Cerca il movimento mancante
            </Button>
          </>
        )}
        <Button variant="secondary" className="w-full" onClick={() => setStep('amount')}>
          Correggi il saldo inserito
        </Button>
      </div>
    </Sheet>
  );
}
