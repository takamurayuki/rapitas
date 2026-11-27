'use client';
// AutoRunSettingsCard

import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserSettings } from '@/types';
import { AutoRunConcurrencyField } from './AutoRunConcurrencyField';
import { AutoRunToggleRow } from './AutoRunToggleRow';

interface AutoRunSettingsCardProps {
  settings: UserSettings | null;
  isSaving: boolean;
  onUpdateSettings: (updates: Partial<UserSettings>) => void;
}

/**
 * Settings that control task auto-execution (auto-run) behaviour — distinct from
 * task-creation settings: the global concurrency limit, the per-theme cap for
 * refilling a theme's queue from the backlog (concerns then ideas) when
 * auto-run runs dry, and the related timers and restart toggles.
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
        {/* Global auto-run concurrency across themes (task 1543). */}
        <AutoRunConcurrencyField
          settings={settings}
          isSaving={isSaving}
          onUpdateSettings={onUpdateSettings}
        />

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
        <AutoRunToggleRow
          label={t('restartOnDryLabel')}
          description={t('restartOnDryDescription')}
          checked={settings?.restartOnAutoRunDry ?? false}
          disabled={isSaving}
          onToggle={() => onUpdateSettings({ restartOnAutoRunDry: !settings?.restartOnAutoRunDry })}
        />

        {/* Auto-restart when merged-but-inactive commits are detected on origin. */}
        <AutoRunToggleRow
          label={t('autoRestartMergedLabel')}
          description={t('autoRestartMergedDescription')}
          checked={settings?.autoRestartOnMergedCode ?? false}
          disabled={isSaving}
          onToggle={() =>
            onUpdateSettings({ autoRestartOnMergedCode: !settings?.autoRestartOnMergedCode })
          }
        />
      </div>
    </div>
  );
}
