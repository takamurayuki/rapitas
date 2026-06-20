'use client';
// AutoRunSettingsCard

import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  return (
    <div className="mt-8 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Play className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">タスク自動実行</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          タスク自動実行（auto-run）の挙動に関する設定です。
        </p>
      </div>
      <div className="space-y-6 p-6">
        {/* Auto-create from backlog limit (per-theme cap; 0 = disabled).
            NOTE: literal JP copy — add i18n keys (devAutoCreateFromBacklog*) later. */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
              懸念・アイデアから自動起票（上限）
            </h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              自動実行でタスクが無くなったとき、懸念バックログ（解決後はアイデアボックス）からタスクを自動起票します。テーマごとの同時起票上限。0で無効。
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
              className="w-16 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-center text-sm text-zinc-900 focus:border-blue-400 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-50"
            />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              件{isSaving ? '（保存中…）' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
