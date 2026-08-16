/**
 * PhaseBreakdown
 *
 * Renders the per-phase (role × runs) active-time breakdown of a task inside
 * the task-detail workflow card, fed by GET /tasks/:id's phaseBreakdown[]
 * aggregation (task #560). NOT responsible for the live ticking timer — that
 * stays on the card / execution panel via useElapsedTime.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

export interface PhaseBreakdownEntry {
  role: string;
  execCount: number;
  activeTimeMs: number;
}

export interface PhaseBreakdownProps {
  taskId: number;
}

/** Workflow roles with a dedicated i18n label; anything else renders raw. */
const KNOWN_ROLES = new Set(['researcher', 'planner', 'implementer', 'verifier']);

/**
 * Format a millisecond duration as a compact clock string.
 *
 * @param ms - Duration in milliseconds / ミリ秒
 * @returns "M:SS" under an hour, "H:MM:SS" past it / 表示用文字列
 */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Per-role active-time breakdown card for one task.
 * Fetches the task detail once per taskId and renders nothing while the task
 * has no finished execution (empty breakdown).
 *
 * @param taskId - Task whose breakdown to display / 対象タスクのID
 * @returns The breakdown card, or null when there is nothing to show / 内訳カード（該当なしは null）
 */
export default function PhaseBreakdown({ taskId }: PhaseBreakdownProps) {
  const t = useTranslations('workflow');
  const [entries, setEntries] = useState<PhaseBreakdownEntry[]>([]);
  const [activeTimeMs, setActiveTimeMs] = useState(0);
  const [wallClockMs, setWallClockMs] = useState(0);

  useEffect(() => {
    if (!taskId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          activeTimeMs?: number;
          wallClockMs?: number;
          phaseBreakdown?: PhaseBreakdownEntry[];
        };
        if (cancelled || !Array.isArray(data.phaseBreakdown)) return;
        setEntries(data.phaseBreakdown);
        setActiveTimeMs(typeof data.activeTimeMs === 'number' ? data.activeTimeMs : 0);
        setWallClockMs(typeof data.wallClockMs === 'number' ? data.wallClockMs : 0);
      } catch {
        // Non-fatal — auxiliary timing info; the section simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (entries.length === 0) return null;

  const roleLabel = (role: string): string =>
    KNOWN_ROLES.has(role) ? t(`taskWorkflowSection.phaseBreakdown.role.${role}`) : role;

  return (
    <div className="px-4 pb-4">
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('taskWorkflowSection.phaseBreakdown.title')}
          </p>
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="rounded-full bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {t('taskWorkflowSection.phaseBreakdown.totalActive', {
                time: formatDurationMs(activeTimeMs),
              })}
            </span>
            {wallClockMs > 0 && (
              <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {t('taskWorkflowSection.phaseBreakdown.wallClock', {
                  time: formatDurationMs(wallClockMs),
                })}
              </span>
            )}
          </span>
        </div>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {entries.map((entry) => (
            <li
              key={entry.role}
              className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
            >
              <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                {roleLabel(entry.role)}
                <span className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('taskWorkflowSection.phaseBreakdown.execCount', {
                    count: entry.execCount,
                  })}
                </span>
              </span>
              <span className="font-mono text-zinc-600 dark:text-zinc-300">
                {formatDurationMs(entry.activeTimeMs)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
