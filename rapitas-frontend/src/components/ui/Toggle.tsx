/**
 * Toggle
 *
 * Accessible iOS-style toggle switch matching the auto-select-mode UI used
 * in WorkflowRolesConfig. The visual rule: a pill-shaped track that fills
 * with the active color, plus a circular thumb that slides right when on.
 *
 * Built on a hidden `<input type="checkbox" class="sr-only peer">` so the
 * track/thumb pick up the `:checked`, `:disabled`, and `:focus-visible`
 * states via Tailwind's `peer-*` selectors — keeping native a11y semantics
 * (keyboard, screen-reader, form integration) without extra wiring.
 *
 * Use the `label` / `description` props for the common "stacked text + switch
 * on the right" layout. For custom layouts, omit them and place the toggle
 * inline; an `aria-label` (via `srLabel`) is required in that case.
 */
'use client';

import { forwardRef, type ReactNode } from 'react';

/**
 * Available switch sizes. Each entry pre-bakes the track width/height and the
 * `after:` (thumb) classes so the runtime only concatenates static strings.
 */
const SIZE_STYLES = {
  sm: 'w-7 h-4 after:h-3 after:w-3 after:top-0.5 after:left-0.5 peer-checked:after:translate-x-3',
  md: 'w-9 h-5 after:h-4 after:w-4 after:top-0.5 after:left-0.5 peer-checked:after:translate-x-4',
  lg: 'w-11 h-6 after:h-5 after:w-5 after:top-0.5 after:left-0.5 peer-checked:after:translate-x-5',
} as const;

type ToggleSize = keyof typeof SIZE_STYLES;

/**
 * Active-state color theme. Each entry packs the `peer-checked:bg-*` rule
 * AND the matching `peer-focus-visible:ring-*` rule into a single static
 * string so Tailwind's JIT compiler can detect them at build time.
 */
const COLOR_STYLES = {
  indigo: 'peer-checked:bg-indigo-500 peer-focus-visible:ring-indigo-500/60',
  blue: 'peer-checked:bg-blue-500 peer-focus-visible:ring-blue-500/60',
  green: 'peer-checked:bg-emerald-500 peer-focus-visible:ring-emerald-500/60',
  amber: 'peer-checked:bg-amber-500 peer-focus-visible:ring-amber-500/60',
  red: 'peer-checked:bg-red-500 peer-focus-visible:ring-red-500/60',
  zinc: 'peer-checked:bg-zinc-700 dark:peer-checked:bg-zinc-300 peer-focus-visible:ring-zinc-500/60',
} as const;

type ToggleColor = keyof typeof COLOR_STYLES;

export interface ToggleProps {
  /** Current checked state. / 現在のオン状態 */
  checked: boolean;
  /** Called with the new checked value when the user toggles. / 切り替え時のコールバック */
  onChange: (checked: boolean) => void;
  /**
   * Optional in-row label. When provided the component renders a flex row
   * with the label + description on the left and the switch on the right.
   * / ラベル（指定時はラベル＋スイッチの行を描画）
   */
  label?: ReactNode;
  /** Helper text rendered below the label. / ラベル下のヘルプテキスト */
  description?: ReactNode;
  /** Optional icon shown before the label (e.g. emoji or lucide icon). / ラベル前のアイコン */
  icon?: ReactNode;
  /** Visual size. Defaults to `md` (matches the auto-select UI). / サイズ */
  size?: ToggleSize;
  /** Active track color. Defaults to `indigo`. / アクティブ色 */
  color?: ToggleColor;
  /** Disable interaction and dim the control. / 無効化 */
  disabled?: boolean;
  /** Screen-reader-only label when no visible `label` is provided. / SR専用ラベル */
  srLabel?: string;
  /** Forwarded `id` so external `<label htmlFor>` works. / id */
  id?: string;
  /** Forwarded `name` for form integration. / form 用 name */
  name?: string;
  /**
   * If `true`, clicking the surrounding label-row should not bubble. Useful
   * when the toggle sits inside an expand/collapse header that also
   * captures clicks. / クリックバブリング抑制
   */
  stopPropagation?: boolean;
  /** Append additional classes to the outer wrapper. / 追加クラス */
  className?: string;
}

const TRACK_BASE =
  "relative rounded-full bg-zinc-300 dark:bg-zinc-600 transition-colors after:content-[''] after:absolute after:bg-white after:rounded-full after:transition-transform peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-zinc-900";

/** Bare switch — track + thumb only, no surrounding label. */
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  {
    checked,
    onChange,
    label,
    description,
    icon,
    size = 'md',
    color = 'indigo',
    disabled = false,
    srLabel,
    id,
    name,
    stopPropagation,
    className,
  },
  ref,
) {
  const sizing = SIZE_STYLES[size];
  const activeColor = COLOR_STYLES[color];
  const switchEl = (
    <span className="inline-flex items-center">
      <input
        ref={ref}
        id={id}
        name={name}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
        aria-label={!label && srLabel ? srLabel : undefined}
      />
      <span
        className={`${TRACK_BASE} ${sizing} ${activeColor}`}
        aria-hidden="true"
      />
    </span>
  );

  if (!label && !description && !icon) {
    return (
      <label
        className={`inline-flex items-center cursor-pointer ${disabled ? 'cursor-not-allowed' : ''} ${className ?? ''}`}
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        {switchEl}
      </label>
    );
  }

  return (
    <label
      className={`flex items-center justify-between gap-3 cursor-pointer ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${className ?? ''}`}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="min-w-0">
          {label ? (
            <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {label}
            </span>
          ) : null}
          {description ? (
            <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      {switchEl}
    </label>
  );
});
