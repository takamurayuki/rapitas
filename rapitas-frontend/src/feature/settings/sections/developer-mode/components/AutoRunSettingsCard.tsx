'use client';
// AutoRunSettingsCard

import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@/types';

interface AutoRunSettingsCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

/**
 * Settings that control task auto-execution (auto-run) behaviour — distinct from
 * task-creation settings. Currently holds the per-theme cap for refilling a
 * theme's queue from the backlog (concerns then ideas) when auto-run runs dry.
 *
 * @param settings - Current user settings. / 現在のユーザー設定
 * @param isSaving - Whether a save is in progress. / 保存中かどうか
 * @param onUpdateSettings - Callback to persist a partial update. / 部分更新を保存するコールバック
 */
export function AutoRunSettingsCard({
  settings,
  isSaving,
  onUpdateSettings,
}: AutoRunSettingsCardProps) {
  const t = useTranslations('settings.autoRunSettingsCard');
  const tCommon = useTranslations('common');
  const tSettings = useTranslations('settings');
  const serverLimit = settings?.autoCreateFromBacklogLimit ?? 0;

  // NOTE: Local state so the field accepts free typing (incl. clearing). Binding
  // straight to the server value + a per-keystroke PATCH disabled the input mid-
  // save and blocked subsequent digits. We persist on blur instead.
  const [localLimit, setLocalLimit] = useState<number | ''>(serverLimit);

  // Re-sync when the server value changes (initial load / external update).
  useEffect(() => {
    setLocalLimit(serverLimit);
  }, [serverLimit]);

  const commit = () => {
    const clamped = localLimit === '' ? 0 : Math.max(0, Math.min(50, localLimit));
    setLocalLimit(clamped);
    if (clamped !== serverLimit) {
      onUpdateSettings({ autoCreateFromBacklogLimit: clamped });
    }
  };

  // Verify->implement self-repair limit (same local-state + blur pattern).
  const serverRepairLimit = settings?.verifyRepairLimit ?? 2;
  const [localRepairLimit, setLocalRepairLimit] = useState<number | ''>(serverRepairLimit);
  useEffect(() => {
    setLocalRepairLimit(serverRepairLimit);
  }, [serverRepairLimit]);
  const commitRepairLimit = () => {
    const clamped = localRepairLimit === '' ? 0 : Math.max(0, Math.min(10, localRepairLimit));
    setLocalRepairLimit(clamped);
    if (clamped !== serverRepairLimit) {
      onUpdateSettings({ verifyRepairLimit: clamped });
    }
  };

  // Idle-stop timer (task 784): minutes of no new filing after the theme runs
  // dry before auto-run is stopped. 0 disables; ceiling 24h (same as the
  // backend clamp). Server default 60 when the column is not migrated yet.
  const serverIdleStop = settings?.idleStopMinutes ?? 60;
  const [localIdleStop, setLocalIdleStop] = useState<number | ''>(serverIdleStop);
  useEffect(() => {
    setLocalIdleStop(serverIdleStop);
  }, [serverIdleStop]);
  const commitIdleStop = () => {
    const clamped = localIdleStop === '' ? 0 : Math.max(0, Math.min(1440, localIdleStop));
    setLocalIdleStop(clamped);
    if (clamped !== serverIdleStop) {
      onUpdateSettings({ idleStopMinutes: clamped });
    }
  };

  // Nightly self-refill window start ("HH:MM"; '' = self-refill disabled).
  // Server default 03:00 when the column is not migrated yet.
  const serverWindowStart = settings?.selfRefillWindowStart ?? '03:00';
  const [localWindowStart, setLocalWindowStart] = useState<string>(serverWindowStart);
  useEffect(() => {
    setLocalWindowStart(serverWindowStart);
  }, [serverWindowStart]);
  const commitWindowStart = (value: string) => {
    setLocalWindowStart(value);
    if (value !== serverWindowStart) {
      onUpdateSettings({ selfRefillWindowStart: value });
    }
  };

  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Play className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {tSettings('devModeTitle')}
          </h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('description')}</p>
      </div>
      <div className="space-y-6 p-6">
        {/* Auto-create from backlog limit (per-theme cap; 0 = disabled). */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('backlogLimitLabel')}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('backlogLimitDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50}
              value={localLimit}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setLocalLimit('');
                  return;
                }
                const num = Number(raw);
                if (Number.isNaN(num)) return;
                setLocalLimit(num);
              }}
              onBlur={commit}
              className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-center text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {tCommon('items')}
              {isSaving ? t('savingSuffix') : ''}
            </span>
          </div>
        </div>

        {/* Verify->implement self-repair limit (retry count; 0 = disabled). */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{t('repairLimitLabel')}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('repairLimitDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={10}
              value={localRepairLimit}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setLocalRepairLimit('');
                  return;
                }
                const num = Number(raw);
                if (Number.isNaN(num)) return;
                setLocalRepairLimit(num);
              }}
              onBlur={commitRepairLimit}
              className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-center text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {tCommon('times')}
              {isSaving ? t('savingSuffix') : ''}
            </span>
          </div>
        </div>

        {/* Idle-stop timer: stop auto-run when nothing new is filed after running dry. */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{t('idleStopLabel')}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('idleStopDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={1440}
              aria-label={t('idleStopLabel')}
              value={localIdleStop}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setLocalIdleStop('');
                  return;
                }
                const num = Number(raw);
                if (Number.isNaN(num)) return;
                setLocalIdleStop(num);
              }}
              onBlur={commitIdleStop}
              className="w-20 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-center text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('idleStopUnit')}
              {isSaving ? t('savingSuffix') : ''}
            </span>
          </div>
        </div>

        {/* Nightly self-refill window start (once per day, not before HH:MM; empty = off). */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('selfRefillWindowLabel')}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('selfRefillWindowDescription')}
            </p>
            {serverWindowStart === '' && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t('selfRefillWindowDisabled')}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              aria-label={t('selfRefillWindowLabel')}
              value={localWindowStart}
              onChange={(e) => setLocalWindowStart(e.target.value)}
              onBlur={() => commitWindowStart(localWindowStart)}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 focus:border-indigo-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
            />
            {serverWindowStart !== '' && (
              <button
                type="button"
                onClick={() => commitWindowStart('')}
                disabled={isSaving}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('selfRefillWindowDisable')}
              </button>
            )}
            {isSaving && (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{t('savingSuffix')}</span>
            )}
          </div>
        </div>

        {/* Restart backend when auto-run runs dry (apply committed fixes safely). */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('restartOnDryLabel')}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('restartOnDryDescription')}
            </p>
          </div>
          <button
            onClick={() =>
              onUpdateSettings({ restartOnAutoRunDry: !settings?.restartOnAutoRunDry })
            }
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              settings?.restartOnAutoRunDry ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
            role="switch"
            aria-checked={settings?.restartOnAutoRunDry ?? false}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                settings?.restartOnAutoRunDry ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Auto-restart when merged-but-inactive commits are detected on origin. */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              {t('autoRestartMergedLabel')}
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t('autoRestartMergedDescription')}
            </p>
          </div>
          <button
            onClick={() =>
              onUpdateSettings({ autoRestartOnMergedCode: !settings?.autoRestartOnMergedCode })
            }
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              settings?.autoRestartOnMergedCode ? 'bg-violet-500' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
            role="switch"
            aria-checked={settings?.autoRestartOnMergedCode ?? false}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                settings?.autoRestartOnMergedCode ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
