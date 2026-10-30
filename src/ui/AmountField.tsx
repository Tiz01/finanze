import { useState } from 'react';
import {
  applyKeypadKey,
  centsToKeypadInput,
  formatCents,
  formatKeypadInput,
  keypadInputToCents,
} from '../domain/money';
import { Button } from './controls';
import { Keypad } from './Keypad';
import { Sheet } from './Sheet';

interface AmountFieldProps {
  title: string;
  cents: number;
  onChange: (cents: number) => void;
  allowNegative?: boolean;
}

export function AmountField({ title, cents, onChange, allowNegative = false }: AmountFieldProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [negative, setNegative] = useState(false);

  function start() {
    setInput(centsToKeypadInput(cents));
    setNegative(cents < 0);
    setOpen(true);
  }

  function confirm() {
    const value = keypadInputToCents(input);
    onChange(negative ? -value : value);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="flex min-h-12 w-full items-center rounded-xl border border-line bg-bg px-3 text-left text-base tabular-nums"
      >
        {formatCents(cents)}
      </button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          <p className="py-3 text-center text-4xl font-semibold tabular-nums">
            {negative ? '−' : ''}
            {formatKeypadInput(input)}&nbsp;€
          </p>
          <div className="space-y-3">
            <Keypad onKey={(key) => setInput((current) => applyKeypadKey(current, key))} />
            <div className="flex gap-2">
              {allowNegative && (
                <Button variant="secondary" className="flex-1" onClick={() => setNegative((current) => !current)}>
                  Cambia segno
                </Button>
              )}
              <Button className="flex-1" onClick={confirm}>
                Fatto
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
