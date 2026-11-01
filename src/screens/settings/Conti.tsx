import { useMemo, useState } from 'react';
import { createAccount, deleteAccount, updateAccount } from '../../db/accounts';
import { useData } from '../../db/DataProvider';
import { ACCOUNT_TYPE_LABELS, defaultCountsAsLiquidity } from '../../domain/accounts';
import { balanceFieldsFor, computeBalances } from '../../domain/balances';
import { todayIso } from '../../domain/dates';
import { formatCents } from '../../domain/money';
import { ACCOUNT_TYPES, type Account, type AccountType } from '../../domain/types';
import { routeHref } from '../../router';
import { AmountField } from '../../ui/AmountField';
import { Button, ButtonRow, Field, ListGroup, SectionTitle, SelectInput, TextInput, ToggleRow } from '../../ui/controls';
import { notify } from '../../ui/feedback';
import { Screen } from '../../ui/Screen';
import { Sheet } from '../../ui/Sheet';

const TYPE_OPTIONS = ACCOUNT_TYPES.map((type) => ({ value: type, label: ACCOUNT_TYPE_LABELS[type] }));

function AccountForm({
  account,
  balanceCents,
  movementCount,
  onClose,
}: {
  account: Account | null;
  balanceCents: number;
  movementCount: number;
  onClose: () => void;
}) {
  const { transactions } = useData();
  // In un conto investimento già creato si cambia il saldo di oggi: è la liquidità, la stessa della scheda Investimenti.
  const editsCash = account?.type === 'investimento';
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState<AccountType>(account?.type ?? 'corrente');
  const [initialCents, setInitialCents] = useState(editsCash ? balanceCents : (account?.initialBalanceCents ?? 0));
  const [initialDate, setInitialDate] = useState(account?.initialBalanceDate ?? todayIso());
  const [liquidity, setLiquidity] = useState(account?.contaComeLiquidita ?? defaultCountsAsLiquidity('corrente'));
  const [liquidityChosen, setLiquidityChosen] = useState(account !== null);
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [error, setError] = useState('');

  function changeType(next: AccountType) {
    setType(next);
    if (!liquidityChosen) setLiquidity(defaultCountsAsLiquidity(next));
  }

  function balanceFields() {
    if (!account || !editsCash) return { initialBalanceCents: initialCents, initialBalanceDate: initialDate };
    if (initialCents === balanceCents) return { initialBalanceCents: account.initialBalanceCents, initialBalanceDate: account.initialBalanceDate };
    return balanceFieldsFor(account, initialCents, transactions, todayIso());
  }

  async function save() {
    const draft = {
      name,
      type,
      currency: account?.currency ?? 'EUR',
      ...balanceFields(),
      archived,
      contaComeLiquidita: liquidity,
    };
    try {
      if (account) await updateAccount(account.id, draft);
      else await createAccount(draft);
      notify(account ? 'Conto aggiornato' : 'Conto creato');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile salvare');
    }
  }

  async function remove() {
    if (!account) return;
    try {
      await deleteAccount(account.id);
      notify('Conto eliminato');
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Non è stato possibile eliminare');
    }
  }

  return (
    <Sheet title={account ? 'Modifica conto' : 'Nuovo conto'} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Nome">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
        </Field>
        <Field label="Tipo">
          <SelectInput value={type} onChange={(value) => changeType(value as AccountType)} options={TYPE_OPTIONS} />
        </Field>
        {type === 'investimento' ? (
          <Field
            label="Liquidità"
            hint={
              editsCash
                ? 'I soldi non investiti che vedi nel broker: è la stessa cifra della scheda Investimenti.'
                : 'I soldi non investiti che vedi nel broker alla data qui sotto.'
            }
          >
            <AmountField title="Liquidità" cents={initialCents} onChange={setInitialCents} allowNegative />
          </Field>
        ) : (
          <Field label="Saldo iniziale" hint="Quello che vedi nell’app della banca alla data qui sotto.">
            <AmountField title="Saldo iniziale" cents={initialCents} onChange={setInitialCents} allowNegative />
          </Field>
        )}
        {!editsCash && (
          <Field label="Data del saldo" hint="I movimenti contano nel saldo da questa data in poi.">
            <TextInput
              type="date"
              value={initialDate}
              onChange={(event) => {
                if (event.target.value) setInitialDate(event.target.value);
              }}
            />
          </Field>
        )}
        <ToggleRow
          label="Conta come liquidità"
          hint="Entra nel totale dei soldi disponibili."
          checked={liquidity}
          onChange={(checked) => {
            setLiquidity(checked);
            setLiquidityChosen(true);
          }}
        />
        {account && (
          <ToggleRow
            label="Archiviato"
            hint="Non si può più scegliere per i nuovi movimenti."
            checked={archived}
            onChange={setArchived}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button className="w-full" onClick={() => void save()}>
          {account ? 'Salva' : 'Crea conto'}
        </Button>
        {account &&
          (movementCount === 0 ? (
            <Button variant="dangerOutline" className="w-full" onClick={() => void remove()}>
              Elimina conto
            </Button>
          ) : (
            <p className="text-center text-xs text-muted">
              Ha {movementCount} {movementCount === 1 ? 'movimento' : 'movimenti'}: per toglierlo dall’uso puoi archiviarlo.
            </p>
          ))}
      </div>
    </Sheet>
  );
}

export function Conti() {
  const { accounts, transactions } = useData();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);

  const balances = useMemo(() => computeBalances(accounts, transactions, todayIso()), [accounts, transactions]);
  const movementCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const add = (id: string | undefined) => {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    };
    for (const transaction of transactions) {
      add(transaction.accountId);
      add(transaction.toAccountId);
    }
    return counts;
  }, [transactions]);

  const active = accounts.filter((account) => !account.archived);
  const archived = accounts.filter((account) => account.archived);

  const row = (account: Account) => (
    <ButtonRow key={account.id} onClick={() => setEditing(account)} detail={formatCents(balances.get(account.id) ?? 0)}>
      <span className="block truncate">{account.name}</span>
      <span className="block truncate text-xs text-muted">
        {ACCOUNT_TYPE_LABELS[account.type]}
        {account.contaComeLiquidita ? ' · liquidità' : ''}
      </span>
    </ButtonRow>
  );

  return (
    <Screen title="Conti" back={{ href: routeHref('impostazioni'), label: 'Impostazioni' }}>
      {active.length === 0 ? (
        <p className="pb-4 text-center text-muted">Aggiungi il primo conto con il saldo che vedi oggi nell’app della banca.</p>
      ) : (
        <ListGroup>{active.map(row)}</ListGroup>
      )}
      <Button className="mt-4 w-full" onClick={() => setEditing('new')}>
        Nuovo conto
      </Button>
      {archived.length > 0 && (
        <>
          <SectionTitle>Archiviati</SectionTitle>
          <ListGroup>{archived.map(row)}</ListGroup>
        </>
      )}
      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          balanceCents={editing === 'new' ? 0 : (balances.get(editing.id) ?? 0)}
          movementCount={editing === 'new' ? 0 : (movementCounts.get(editing.id) ?? 0)}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  );
}
