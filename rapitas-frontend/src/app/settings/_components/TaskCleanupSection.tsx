'use client';
// TaskCleanupSection

import { useEffect, useState } from 'react';
import { Trash2, Loader2, FolderOpen, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface ThemeOption {
  id: number;
  name: string;
}

/** Result shape returned by POST /tasks/cleanup-completed. */
interface CleanupResult {
  dryRun: boolean;
  keepRecent: number;
  themeId: number | null;
  completedTotal: number;
  candidateCount: number;
  deletedCount: number;
  knowledgeRecorded: number;
  alreadyRecorded: number;
  skippedWithOpenSubtasks: number;
  message?: string;
}

const DEFAULT_KEEP_RECENT = 100;

/**
 * Settings panel to prune old COMPLETED tasks, per theme (or all themes).
 * Knowledge is recorded before deletion (skipped when already recorded), and the
 * task's workflow md files + worktrees are removed. Always preview (dryRun)
 * before the destructive run.
 */
export function TaskCleanupSection() {
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  // '' = all themes; otherwise the selected theme id (as string).
  const [themeId, setThemeId] = useState<string>('');
  const [keepRecent, setKeepRecent] = useState<number>(DEFAULT_KEEP_RECENT);
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/themes`);
        if (res.ok) {
          const data = (await res.json()) as ThemeOption[] | { themes?: ThemeOption[] };
          const list = Array.isArray(data) ? data : (data.themes ?? []);
          setThemes(list.map((t) => ({ id: t.id, name: t.name })));
        }
      } catch {
        /* theme list is optional — the "all themes" option still works */
      }
    })();
  }, []);

  const callCleanup = async (dryRun: boolean) => {
    setBusy(dryRun ? 'preview' : 'run');
    setError(null);
    if (dryRun) setResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/cleanup-completed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepRecent: Number.isFinite(keepRecent) ? keepRecent : DEFAULT_KEEP_RECENT,
          dryRun,
          themeId: themeId === '' ? null : Number(themeId),
        }),
      });
      const data = (await res.json()) as CleanupResult & { error?: string };
      if (!res.ok || (data as { success?: boolean }).success === false) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理に失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const onRun = async () => {
    const scope =
      themeId === ''
        ? '全テーマ'
        : (themes.find((t) => String(t.id) === themeId)?.name ?? `テーマ#${themeId}`);
    const n = result && result.dryRun ? result.candidateCount : null;
    const confirmMsg =
      `[${scope}] 直近${keepRecent}件を残し、それより古い完了タスクを削除します。` +
      (n !== null ? `\n削除対象: 約${n}件。` : '') +
      `\nナレッジ未記録のものは記録してから削除します。元に戻せません。実行しますか？`;
    if (!window.confirm(confirmMsg)) return;
    await callCleanup(false);
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-2xl dark:shadow-black/50 overflow-hidden">
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Trash2 className="w-5 h-5 text-zinc-400" />
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">タスク整理</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              テーマごとに、直近N件を残して古い完了タスクを削除します。削除前にナレッジを記録（記録済みはスキップ）し、ワークフローのmdファイルも削除します。
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Theme selector */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">対象テーマ</span>
            <span className="flex items-center gap-1.5">
              <FolderOpen className="h-4 w-4 text-zinc-400" />
              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">全テーマ</option>
                {themes.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          {/* keepRecent */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">保持件数（直近）</span>
            <input
              type="number"
              min={0}
              value={keepRecent}
              onChange={(e) => setKeepRecent(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={() => callCleanup(true)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              プレビュー
            </button>
            <button
              onClick={onRun}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy === 'run' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              整理を実行
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              result.dryRun
                ? 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300'
                : 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
            }`}
          >
            <p className="font-medium">{result.message}</p>
            <p className="mt-1 text-xs opacity-80">
              完了タスク総数 {result.completedTotal} / 対象 {result.candidateCount} /{' '}
              {result.dryRun ? '削除予定' : '削除済み'} {result.deletedCount} / ナレッジ新規記録{' '}
              {result.knowledgeRecorded} / 記録済み {result.alreadyRecorded} / サブタスク未完で除外{' '}
              {result.skippedWithOpenSubtasks}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
