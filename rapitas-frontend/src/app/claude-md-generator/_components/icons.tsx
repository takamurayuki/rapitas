/**
 * icons
 *
 * Lightweight inline SVG icon components used throughout the wizard.
 * Kept separate so they can be imported without pulling in heavier modules.
 */

'use client';

/** Renders a white checkmark polyline inside a 11×11 SVG viewport. */
export function CheckIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 11 11">
      <polyline
        points="1,5.5 4,8.5 10,2"
        stroke="white"
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Renders a small white filled circle used as a radio-button indicator. */
export function DotIcon() {
  return (
    <div
      style={{ width: 7, height: 7, borderRadius: '50%', background: 'white' }}
    />
  );
}
