'use client';

/**
 * ToggleSwitch
 *
 * Reusable accessible toggle control used throughout the DeveloperModeConfig modal.
 * Not responsible for any business logic; purely presentational.
 */

type Props = {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
};

/**
 * Renders a labelled toggle switch row.
 *
 * @param props.value - Current on/off state. / 現在のオン/オフ状態
 * @param props.onChange - Callback invoked with the toggled value. / 切り替え後の値を受け取るコールバック
 * @param props.label - Primary label text shown above the description. / 主ラベル
 * @param props.description - Secondary description shown below the label. / 補足説明
 */
export function ToggleSwitch({ value, onChange, label, description }: Props) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
          value ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            value ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}
