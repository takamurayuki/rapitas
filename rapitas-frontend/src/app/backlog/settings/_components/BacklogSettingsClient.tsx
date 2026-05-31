'use client';

/**
 * BacklogSettingsClient
 *
 * Settings page for the backlog's periodic AI jobs: lets the user choose WHEN
 * the idea-box innovation session and the concern-backlog vulnerability/bug scan
 * run (enable, frequency, hour, weekday), and trigger either one immediately.
 * Reads/writes /backlog/schedules. Not responsible for running the jobs.
 */

import { useState, useEffect, useCallback } from 'react';
import { Lightbulb, Bug, Activity, Play, Loader2, CalendarClock } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type JobKind = 'innovation' | 'vuln_scan' | 'health_check';
type Frequency = 'daily' | 'weekly';

interface Schedule {
  kind: JobKind;
  enabled: boolean;
  frequency: Frequency;
  hour: number;
  weekday: number;
  lastRunAt: string | null;
}

const JOB_META: Record<
  JobKind,
  { label: string; icon: typeof Lightbulb; color: string; desc: string }
> = {
  innovation: {
    label: 'イノベーションセッション',
    icon: Lightbulb,
    color: 'text-amber-500',
    desc: '完了タスクや既存機能を分析し、新しい価値のアイデアを生成してアイデアボックスに蓄積します。',
  },
  vuln_scan: {
    label: '脆弱性・バグ調査',
    icon: Bug,
    color: 'text-rose-500',
    desc: '各テーマの直近のコード変更をAIがレビューし、バグ・セキュリティ上の懸念を懸念バックログに起票します（依存の既知脆弱性も bun audit で確認）。',
  },
  health_check: {
    label: 'ログヘルスチェック',
    icon: Activity,
    color: 'text-sky-500',
    desc: 'その日のバックエンドログから warning / error を抽出し、種類ごとにまとめて懸念バックログに起票します。',
  },
};

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'daily', label: '毎日' },
  { value: 'weekly', label: '毎週' },
];
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** Formats an ISO timestamp as a short local datetime, or a dash. */
function formatLastRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

export default function BacklogSettingsClient() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [runningKind, setRunningKind] = useState<JobKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/backlog/schedules`);
        if (res.ok) {
          const data = (await res.json()) as { schedules: Schedule[] };
          setSchedules(data.schedules);
        }
      } catch {
        /* non-fatal */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const patchSchedule = useCallback(
    async (kind: JobKind, partial: Partial<Schedule>) => {
      // Optimistic update — revert on failure.
      setSchedules((prev) => prev.map((s) => (s.kind === kind ? { ...s, ...partial } : s)));
      try {
        const res = await fetch(`${API_BASE_URL}/backlog/schedules/${kind}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
        if (res.ok) {
          const data = (await res.json()) as { schedule: Schedule };
          setSchedules((prev) => prev.map((s) => (s.kind === kind ? data.schedule : s)));
        }
      } catch {
        /* keep optimistic value; a reload will resync */
      }
    },
    [],
  );

  const runNow = useCallback(async (kind: JobKind) => {
    setRunningKind(kind);
    setNotice(null);
    try {
      const res = await fetch(`${API_BASE_URL}/backlog/schedules/${kind}/run-now`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        setNotice(
          kind === 'innovation'
            ? '実行を開始しました。生成されたアイデアはアイデアボックスに表示されます。'
            : '実行を開始しました。検出された懸念は懸念バックログに表示されます。',
        );
      }
    } catch {
      /* non-fatal */
    } finally {
      setRunningKind(null);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        <CalendarClock className="h-5 w-5 text-zinc-500" />
        定期調査スケジュール
      </div>
      <p className="mb-5 text-sm text-zinc-500 dark:text-zinc-400">
        AIエージェントは実装時に随時アイデア・懸念を起票します。ここではそれとは別に、定期的に実行する調査のタイミングを設定します。
      </p>

      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <div className="space-y-4">
        {schedules.map((s) => {
          const meta = JOB_META[s.kind];
          const Icon = meta.icon;
          return (
            <div
              key={s.kind}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Icon className={`mt-0.5 h-5 w-5 ${meta.color}`} />
                  <div>
                    <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {meta.label}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{meta.desc}</p>
                  </div>
                </div>
                {/* Enable toggle */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.enabled}
                  onClick={() => patchSchedule(s.kind, { enabled: !s.enabled })}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    s.enabled ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                      s.enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Schedule controls */}
              <div
                className={`mt-3 flex flex-wrap items-center gap-2 ${
                  s.enabled ? '' : 'pointer-events-none opacity-40'
                }`}
              >
                <select
                  value={s.frequency}
                  onChange={(e) => patchSchedule(s.kind, { frequency: e.target.value as Frequency })}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                {s.frequency === 'weekly' && (
                  <select
                    value={s.weekday}
                    onChange={(e) => patchSchedule(s.kind, { weekday: parseInt(e.target.value) })}
                    className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                  >
                    {WEEKDAYS.map((w, i) => (
                      <option key={i} value={i}>
                        {w}曜
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={s.hour}
                  onChange={(e) => patchSchedule(s.kind, { hour: parseInt(e.target.value) })}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>

                <span className="text-xs text-zinc-400">最終実行: {formatLastRun(s.lastRunAt)}</span>

                <button
                  type="button"
                  onClick={() => runNow(s.kind)}
                  disabled={runningKind === s.kind}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {runningKind === s.kind ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                  今すぐ実行
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
