import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

const BUTTON_VARIANTS = {
  primary: 'bg-accent text-on-accent',
  secondary: 'border border-line bg-surface text-ink',
  danger: 'bg-danger text-on-danger',
  dangerOutline: 'border border-line bg-surface text-danger',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANTS;
}

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`min-h-12 rounded-xl px-4 font-semibold active:opacity-80 disabled:opacity-40 ${BUTTON_VARIANTS[variant]} ${className}`}
    />
  );
}

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="flex min-h-12 items-center justify-center rounded-xl bg-accent px-4 font-semibold text-on-accent active:opacity-80">
      {children}
    </a>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// Almeno 16px: con meno, iOS ingrandisce la pagina quando il campo prende il focus.
const INPUT_CLASS = 'min-h-12 w-full min-w-0 rounded-xl border border-line bg-bg px-3 text-base';

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASS} ${className}`} />;
}

export function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={INPUT_CLASS}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 text-left"
    >
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'}`}>
        <span
          className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : ''
          }`}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex gap-1 rounded-xl bg-bg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-10 flex-1 rounded-lg px-2 text-sm font-medium ${
            option.value === value ? 'bg-surface shadow-sm' : 'text-muted'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const CHIP_CLASS = 'relative inline-flex min-h-10 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-full border px-3 text-sm';

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** Un'etichetta compatta che apre il selettore nativo di iOS. */
export function SelectChip({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  active = false,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  active?: boolean;
}) {
  return (
    <span className={`${CHIP_CLASS} ${active ? 'border-accent text-accent' : 'border-line'}`}>
      <span className="truncate">{label}</span>
      <ChevronDown />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-0 w-full text-base opacity-0"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function DateChip({
  label,
  ariaLabel,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className={`${CHIP_CLASS} border-line`}>
      <span className="truncate">{label}</span>
      <ChevronDown />
      <input
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className="absolute inset-0 w-full text-base opacity-0"
      />
    </span>
  );
}

export function ListGroup({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">{children}</div>;
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pt-4 pb-2 text-sm font-semibold text-muted first:pt-0">{children}</h2>;
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const ROW_CLASS = 'flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left active:bg-bg';

export function LinkRow({ href, title, detail }: { href: string; title: string; detail?: string }) {
  return (
    <a href={href} className={ROW_CLASS}>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {detail && <span className="shrink-0 text-sm text-muted">{detail}</span>}
      <ChevronRight />
    </a>
  );
}

export function ButtonRow({
  onClick,
  children,
  detail,
}: {
  onClick: () => void;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={ROW_CLASS}>
      <span className="min-w-0 flex-1">{children}</span>
      {detail && <span className="shrink-0 text-sm text-muted tabular-nums">{detail}</span>}
      <ChevronRight />
    </button>
  );
}
