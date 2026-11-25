'use client';
/**
 * AutoRunConcurrencyField
 *
 * The auto-run settings row for the global concurrency limit (task 1543):
 * a 1..4 number input saved on blur, disabled with a note while the
 * AUTO_RUN_GLOBAL_MAX_CONCURRENCY env var overrides the saved value.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@/types';

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 4;

interface AutoRunConcurrencyFieldProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

/**
 * Concurrency limit input for the auto-run settings card.
 *
 * @param settings - Current user settings. / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress. / 保存中かどうか
 * @param onUpdateSettings - Callback to persist a partial update. / 部分更新を保存するコールバック
 */
export function AutoRunConcurrencyField({
  settings,
  isSaving,
  onUpdateSettings,
}: AutoRunConcurrencyFieldProps) {
  const t = useTranslations('settings.autoRunSettingsCard');
  const serverValue = settings?.autoRunMaxConcurrency ?? 1;
  const envOverride = settings?.autoRunMaxConcurrencyEnvOverride ?? null;

  // NOTE: Local state + save on blur, same as the other numeric fields — a
  // per-keystroke PATCH disabled the input mid-save.
  const [localValue, setLocalValue] = useState<number | ''>(serverValue);
  useEffect(() => {
    setLocalValue(serverValue);
  }, [serverValue]);

  const commit = () => {
    const clamped =
      localValue === ''
        ? MIN_CONCURRENCY
        : Math.max(MIN_CONCURRENCY, Math.min(MAX_CONCURRENCY, Math.floor(localValue)));
    setLocalValue(clamped);
    if (clamped !== serverValue) {
      onUpdateSettings({ autoRunMaxConcurrency: clamped });
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{t('maxConcurrencyLabel')}</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {t('maxConcurrencyDescription')}
        </p>
        {envOverride !== null && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {t('maxConcurrencyEnvOverride', { value: envOverride })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={MIN_CONCURRENCY}
          max={MAX_CONCURRENCY}
          aria-label={t('maxConcurrencyLabel')}
          value={localValue}
          disabled={envOverride !== null}
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
          className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-center text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
        />
        {isSaving && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('savingSuffix')}</span>
        )}
      </div>
    </div>
  );
}
