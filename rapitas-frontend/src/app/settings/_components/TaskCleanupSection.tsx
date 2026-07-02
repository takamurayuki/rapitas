'use client';
// TaskCleanupSection

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Loader2, FolderOpen, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';

interface ThemeOption {
  id: number;
  name: string;
  workingDirectory?: string | null;
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
  const t = useTranslations('settings.taskCleanupSection');
  const confirm = useConfirmDialog();
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
          // Only themes with a working directory — those are the ones that
          // actually run tasks (and thus accumulate completed tasks to prune).
          setThemes(
            list
              .filter((t) => typeof t.workingDirectory === 'string' && t.workingDirectory.trim())
              .map((t) => ({ id: t.id, name: t.name })),
          );
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
      setError(e instanceof Error ? e.message : t('processFailed'));
    } finally {
      setBusy(null);
    }
  };

  const onRun = async () => {
    const scope =
      themeId === ''
        ? t('allThemes')
        : (themes.find((theme) => String(theme.id) === themeId)?.name ??
          t('themeFallback', { themeId }));
    const n = result && result.dryRun ? result.candidateCount : null;
    const confirmMsg = t('confirmMessage', {
      scope,
      keepRecent,
      candidateLine: n !== null ? t('confirmCandidateLine', { n }) : '',
    });
    if (!(await confirm({ message: confirmMsg }))) return;
    await callCleanup(false);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-indigo-dark-900">
      <div className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <Trash2 className="h-5 w-5 text-violet-500" />
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('description')}</p>
      </div>

      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-end gap-4">
          {/* Theme selector */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('targetTheme')}</span>
            <span className="flex items-center gap-1.5">
              <FolderOpen className="h-4 w-4 text-zinc-400" />
              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                <option value="">{t('allThemes')}</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={String(theme.id)}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </span>
          </label>

          {/* keepRecent */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {t('keepRecentLabel')}
            </span>
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
              {t('preview')}
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
              {t('runCleanup')}
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
              {t('resultSummary', {
                completedTotal: result.completedTotal,
                candidateCount: result.candidateCount,
                statusLabel: result.dryRun ? t('pendingDeletion') : t('alreadyDeleted'),
                deletedCount: result.deletedCount,
                knowledgeRecorded: result.knowledgeRecorded,
                alreadyRecorded: result.alreadyRecorded,
                skippedWithOpenSubtasks: result.skippedWithOpenSubtasks,
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
