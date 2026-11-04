import { MAX_INTERVAL_MONTHS, parseInterestForm, previewInterest, type InterestFormValues } from '../domain/interest';
import { formatCents } from '../domain/money';
import type { InterestRateKind } from '../domain/types';
import { Field, Segmented, SelectInput, TextInput } from './controls';

const KIND_OPTIONS = [
  { value: 'lordo', label: 'Lordo' },
  { value: 'netto', label: 'Netto' },
] as const satisfies readonly { value: InterestRateKind; label: string }[];

const INTERVAL_OPTIONS = Array.from({ length: MAX_INTERVAL_MONTHS }, (_, index) => ({
  value: String(index + 1),
  label: index === 0 ? 'Ogni mese' : `Ogni ${index + 1} mesi`,
}));

/** Le condizioni di un conto remunerato, con quello che rendono sulla somma indicata. */
export function InterestFields({
  values,
  onChange,
  balanceCents,
}: {
  values: InterestFormValues;
  onChange: (values: InterestFormValues) => void;
  balanceCents: number;
}) {
  const patch = (fields: Partial<InterestFormValues>) => onChange({ ...values, ...fields });
  const { terms } = parseInterestForm(values);
  const preview = terms && balanceCents > 0 ? previewInterest(terms, balanceCents) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 items-end gap-2">
        <Field label="Tasso annuo (%)">
          <TextInput
            value={values.rateText}
            onChange={(event) => patch({ rateText: event.target.value })}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="Es. 4"
            className="tabular-nums"
          />
        </Field>
        <Segmented options={KIND_OPTIONS} value={values.rateKind} onChange={(rateKind) => patch({ rateKind })} />
      </div>
      {values.rateKind === 'lordo' && (
        <Field label="Ritenuta sugli interessi (%)" hint="Sui conti in Italia di solito è il 26%.">
          <TextInput
            value={values.taxText}
            onChange={(event) => patch({ taxText: event.target.value })}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>
      )}
      <Field label="Gli interessi arrivano">
        <SelectInput
          value={String(values.intervalMonths)}
          onChange={(value) => patch({ intervalMonths: Number(value) })}
          options={INTERVAL_OPTIONS}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Da quando">
          <TextInput
            type="date"
            value={values.startDate}
            onChange={(event) => {
              if (event.target.value) patch({ startDate: event.target.value });
            }}
          />
        </Field>
        <Field label="Per quanti mesi">
          <TextInput
            value={values.termText}
            onChange={(event) => patch({ termText: event.target.value })}
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="Senza fine"
            className="tabular-nums"
          />
        </Field>
      </div>
      {preview && (
        <p className="rounded-xl bg-bg px-3 py-2 text-sm">
          Con {formatCents(balanceCents)} per {preview.months} {preview.months === 1 ? 'mese' : 'mesi'}:{' '}
          <span className="font-semibold text-positive">+{formatCents(preview.netCents)}</span> netti
          {preview.taxCents > 0 && ` (${formatCents(preview.grossCents)} lordi, ${formatCents(preview.taxCents)} di ritenuta)`}. Alla fine:{' '}
          <span className="font-semibold">{formatCents(preview.finalCents)}</span>.
        </p>
      )}
    </div>
  );
}
