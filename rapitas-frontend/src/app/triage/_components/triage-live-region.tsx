'use client';
/**
 * triage-live-region
 *
 * Always-mounted aria-live regions that read out short action results.
 * Polite for routine results; assertive only for conflicts and failures.
 * Not responsible for composing the message text (the caller passes it in).
 */

interface TriageLiveRegionProps {
  /** Text to read, already localized / 読み上げる文言 */
  message: string;
  /** assertive is reserved for conflict and failure / 競合・失敗時のみassertive */
  politeness: 'polite' | 'assertive';
  /** Changes on every announcement so identical text is re-read / 同文でも再読させる連番 */
  seq: number;
}

/**
 * Render both live regions; only the one matching the politeness holds text.
 */
export function TriageLiveRegion({ message, politeness, seq }: TriageLiveRegionProps) {
  // NOTE: both regions stay mounted — screen readers only announce changes to
  // regions that already exist in the DOM. The seq suffix (zero-width) forces
  // a text change when the same sentence repeats.
  const text = seq % 2 === 0 ? message : `${message}​`;
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {politeness === 'polite' ? text : ''}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {politeness === 'assertive' ? text : ''}
      </div>
    </>
  );
}
