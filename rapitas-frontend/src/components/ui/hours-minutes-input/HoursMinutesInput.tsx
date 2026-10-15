/**
 * DurationInput (file kept at hours-minutes-input/ for its import path)
 *
 * Shared duration input for values stored as decimal hours: ONE number field
 * plus an h⇄m unit toggle (operator decision 2026-09-03 — a flexible unit
 * beats fixed hour-only entry or a rigid h+m pair). Drop-in for existing
 * string-typed decimal-hour form state: `value` is decimal hours as a string
 * ('' = unset) and `onChange` receives the same shape.
 */
'use client';

import { useState } from 'react';

type DurationUnit = 'h' | 'm';

interface DurationInputProps {
  /** Decimal hours as a string ('' when unset) — matches legacy form state. */
  value: string;
  onChange: (decimalHours: string) => void;
  /** Forwarded to the number field - some callers persist on blur. */
  onBlur?: () => void;
  'aria-label': string;
}

/** Convert decimal hours to the number shown for a unit ('' stays empty). */
function display(value: string, unit: DurationUnit): string {
  const n = parseFloat(value);
  if (value === '' || !Number.isFinite(n)) return '';
  // Round to kill float noise (0.6667h -> 40m, not 40.002m).
  return unit === 'h' ? String(Math.round(n * 100) / 100) : String(Math.round(n * 60));
}

/** Convert a typed number back to decimal hours for the given unit. */
function toHours(raw: string, unit: DurationUnit): string {
  if (raw === '') return '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return '';
  return unit === 'h' ? raw : String(Math.round((n / 60) * 10000) / 10000);
}

export default function DurationInput({
  value,
  onChange,
  onBlur,
  'aria-label': ariaLabel,
}: DurationInputProps) {
  // Initial unit follows the display rule: minutes under 1h, hours from 1h.
  const [unit, setUnit] = useState<DurationUnit>(() => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n > 0 && n < 1 ? 'm' : 'h';
  });

  const toggleUnit = () => setUnit((u) => (u === 'h' ? 'm' : 'h'));

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        step={unit === 'h' ? '0.5' : '5'}
        placeholder="0"
        value={display(value, unit)}
        onChange={(e) => onChange(toHours(e.target.value, unit))}
        onBlur={onBlur}
        aria-label={ariaLabel}
        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:border-indigo-400"
      />
      {/* Unit toggle — converts the shown number, the stored hours stay put. */}
      <button
        type="button"
        onClick={toggleUnit}
        aria-label={`${ariaLabel}: ${unit === 'h' ? 'h → m' : 'm → h'}`}
        title={unit === 'h' ? 'h → m' : 'm → h'}
        className="shrink-0 rounded-lg bg-zinc-100 px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      >
        {unit}
      </button>
    </div>
  );
}
