'use client';
/**
 * AutoRunToggleRow
 *
 * A labelled on/off switch row used by the auto-run settings card. Holds no
 * state; the caller decides what toggling persists.
 */

interface AutoRunToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/**
 * Switch row with a heading and description.
 *
 * @param label - Row heading. / 見出し
 * @param description - Explanatory text. / 説明文
 * @param checked - Current switch state. / 現在のオン・オフ
 * @param disabled - Disable the switch (e.g. while saving). / 無効化するか
 * @param onToggle - Called when the switch is clicked. / クリック時のコールバック
 */
export function AutoRunToggleRow({
  label,
  description,
  checked,
  disabled,
  onToggle,
}: AutoRunToggleRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{label}</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
