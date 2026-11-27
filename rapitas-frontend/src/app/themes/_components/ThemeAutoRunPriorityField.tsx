/**
 * ThemeAutoRunPriorityField
 *
 * Number input for a theme's auto-run priority (task 1543): when one global
 * auto-run slot frees up, the theme with the higher value picks next.
 * Shown for every theme, not only development ones — auto-run is not
 * limited to development themes. Owns only the in-progress text.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

const MIN_PRIORITY = -100;
const MAX_PRIORITY = 100;

type Props = {
  value: number;
  onChange: (value: number) => void;
};

/**
 * Priority input that clamps to -100..100 on blur.
 *
 * @param props.value - Current priority. / 現在の優先度
 * @param props.onChange - Called with the clamped value when it changed. / 丸めた値が変わったときに呼ばれる
 */
export function ThemeAutoRunPriorityField({ value, onChange }: Props) {
  const t = useTranslations('themes');
  const [localValue, setLocalValue] = useState<number | ''>(value);
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const commit = () => {
    const clamped =
      localValue === ''
        ? 0
        : Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, Math.floor(localValue)));
    setLocalValue(clamped);
    if (clamped !== value) onChange(clamped);
  };

  return (
    <div>
      <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
        {t('autoRunPriorityLabel')}
      </label>
      <input
        type="number"
        min={MIN_PRIORITY}
        max={MAX_PRIORITY}
        value={localValue}
        aria-label={t('autoRunPriorityLabel')}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            setLocalValue('');
            return;
          }
          const num = Number(raw);
          if (Number.isNaN(num)) return;
          setLocalValue(num);
        }}
        onBlur={commit}
        className="w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-all"
      />
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t('autoRunPriorityDescription')}
      </p>
    </div>
  );
}
