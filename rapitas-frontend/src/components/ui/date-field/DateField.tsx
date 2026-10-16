/**
 * DateField
 *
 * Shared replacement for `<input type="date">` / `<input type="datetime-local">`
 * that always shows `yyyy/mm/dd [HH:mm]`, matching the app's locale-independent
 * datetime shape (operator decision 2026-09-03). A calendar button still opens
 * the browser's own picker, so nothing is lost by not using the native field.
 *
 * Why this exists rather than a setting: the native input's field order comes
 * from the browser UI locale and the page cannot change it. Measured 2026-10-07
 * in the running WebView2 and in Edge — the `lang` attribute has no effect, and
 * `--lang=ja` only switches the clock to 24h while the date stays mm/dd/yyyy
 * (only `--lang=zh-CN` gives yyyy/mm/dd, at the cost of a Chinese browser UI).
 *
 * Drop-in for the call sites it replaces: `value` and `onChange` carry the same
 * `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` strings the native input used.
 * Not responsible for the string conversion itself (date-field-format.ts).
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toDisplayValue, parseDisplayValue } from './date-field-format';

export interface DateFieldProps {
  /** `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when `withTime` — '' when unset. */
  value: string;
  /** Receives the same shape as `value` ('' when cleared). */
  onChange: (value: string) => void;
  /** Edit a date and time instead of a date alone. */
  withTime?: boolean;
  /** Forwarded to the picker, same semantics as the native attributes. */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Some callers persist on blur rather than on every keystroke. */
  onBlur?: () => void;
  /** Applied to the text field, so a call site's existing classes keep working. */
  className?: string;
  /** Applied to the wrapper, for the slot's own layout (e.g. `flex-1`). */
  wrapperClassName?: string;
  'aria-label'?: string;
  id?: string;
}

/**
 * Date/datetime entry in `yyyy/mm/dd [HH:mm]` with a native picker button.
 *
 * @param props - See {@link DateFieldProps}. / プロパティ
 * @returns The field element. / 入力欄要素
 */
export default function DateField({
  value,
  onChange,
  withTime = false,
  min,
  max,
  required,
  disabled,
  autoFocus,
  onBlur,
  className,
  wrapperClassName,
  'aria-label': ariaLabel,
  id,
}: DateFieldProps) {
  const [text, setText] = useState(() => toDisplayValue(value, withTime));
  const pickerRef = useRef<HTMLInputElement>(null);
  // Tracks whether the user is mid-edit, so a parent re-render cannot overwrite
  // a half-typed "2026/1" back to the committed value under the cursor.
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setText(toDisplayValue(value, withTime));
  }, [value, withTime]);

  const handleText = (raw: string) => {
    editingRef.current = true;
    setText(raw);
    const parsed = parseDisplayValue(raw, withTime);
    // Only publish a value we could actually parse; an in-progress string is
    // kept locally until it becomes valid or the field is left.
    if (parsed !== null) onChange(parsed);
  };

  const handleBlur = () => {
    editingRef.current = false;
    // Re-render from the committed value so a rejected entry never lingers on
    // screen as if it had been accepted.
    setText(toDisplayValue(value, withTime));
    onBlur?.();
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      // showPicker throws when it is not treated as user-initiated; focusing the
      // hidden input still lets the browser's own indicator take over.
      el.focus();
    }
  };

  return (
    <span className={cn('relative inline-flex w-full items-center gap-1', wrapperClassName)}>
      {/* The button sits in flow rather than over the field: an absolutely
          positioned icon would need right padding on the input, and a `pr-*`
          added here cannot reliably beat a caller's own `px-*` (Tailwind
          utilities tie on specificity, so CSS source order decides). */}
      <input
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={withTime ? 'yyyy/mm/dd HH:mm' : 'yyyy/mm/dd'}
        onChange={(e) => handleText(e.target.value)}
        onBlur={handleBlur}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        id={id}
        // flex-1 governs the main axis over any width the caller set, and
        // min-w-0 lets it shrink inside a narrow flex parent.
        className={cn('min-w-0 flex-1', className)}
      />
      <button
        type="button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={ariaLabel}
        className="shrink-0 text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-40 dark:hover:text-zinc-200"
      >
        {/* Calendar already stands for a date/deadline in the task detail header. */}
        <Calendar className="h-4 w-4" />
      </button>
      {/* Kept in layout (not display:none) because showPicker() refuses to open
          for a hidden input; sized to nothing so it never shows its own text. */}
      <input
        ref={pickerRef}
        type={withTime ? 'datetime-local' : 'date'}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          editingRef.current = false;
          onChange(e.target.value);
        }}
        className="pointer-events-none absolute right-0 bottom-0 h-0 w-0 border-0 p-0 opacity-0"
      />
    </span>
  );
}
