'use client';

/**
 * ProjectOverridesSection
 *
 * Per-project (per-theme) overrides for the backlog jobs. Lets the user disable
 * a job for a specific project and, for the log health check, point it at that
 * project's log directory + format (projects log differently or not at all).
 * Scheduling stays global (see BacklogSettingsClient). Reads/writes
 * /backlog/theme-overrides.
 */

import { useState, useEffect, useCallback } from 'react';
import { Lightbulb, Bug, Activity, Loader2, FolderCog } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type JobKind = 'innovation' | 'vuln_scan' | 'health_check';
type LogFormat = 'pino' | 'json' | 'text';

interface ThemeRow {
  id: number;
  name: string;
  workingDirectory: string | null;
}
interface Override {
  kind: JobKind;
  themeId: number;
  enabled: boolean;
  logDir: string | null;
  logFormat: LogFormat | null;
}

const PROJECT_JOBS: {
  kind: JobKind;
  label: string;
  icon: typeof Lightbulb;
  color: string;
  defaultEnabled: boolean;
  hasLogConfig?: boolean;
}[] = [
  { kind: 'innovation', label: 'イノベーション', icon: Lightbulb, color: 'text-amber-500', defaultEnabled: true },
  {
    kind: 'vuln_scan',
    label: '脆弱性・バグ調査',
    icon: Bug,
    color: 'text-rose-500',
    defaultEnabled: true,
  },
  {
    kind: 'health_check',
    label: 'ログヘルスチェック',
    icon: Activity,
    color: 'text-sky-500',
    defaultEnabled: false,
    hasLogConfig: true,
  },
];

const LOG_FORMATS: { value: LogFormat; label: string }[] = [
  { value: 'pino', label: 'pino / NDJSON' },
  { value: 'json', label: '汎用JSON' },
  { value: 'text', label: 'プレーンテキスト' },
];

/** Small on/off switch matching the global settings toggle. */
function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function ProjectOverridesSection() {
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  const keyOf = (kind: JobKind, themeId: number) => `${kind}:${themeId}`;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/backlog/theme-overrides`);
        if (res.ok) {
          const data = (await res.json()) as { themes: ThemeRow[]; overrides: Override[] };
          // Only projects with a working directory are schedulable.
          setThemes(data.themes.filter((t) => t.workingDirectory));
          setOverrides(new Map(data.overrides.map((o) => [keyOf(o.kind, o.themeId), o])));
        }
      } catch {
        /* non-fatal */
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const patch = useCallback(
    async (kind: JobKind, themeId: number, partial: Partial<Override>) => {
      const key = keyOf(kind, themeId);
      setOverrides((prev) => {
        const next = new Map(prev);
        const cur = next.get(key) ?? { kind, themeId, enabled: true, logDir: null, logFormat: null };
        next.set(key, { ...cur, ...partial });
        return next;
      });
      try {
        const res = await fetch(`${API_BASE_URL}/backlog/theme-overrides/${kind}/${themeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(partial),
        });
        if (res.ok) {
          const data = (await res.json()) as { override: Override };
          setOverrides((prev) => new Map(prev).set(key, data.override));
        }
      } catch {
        /* keep optimistic value */
      }
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        <FolderCog className="h-4 w-4 text-zinc-500" />
        プロジェクト別設定
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
作業ディレクトリを設定したプロジェクト（テーマ）のみ対象です。ジョブごとに有効/無効を切り替えられます。ログヘルスチェックは、プロジェクトのログ出力先と形式を指定したときだけそのプロジェクトを対象にします。スケジュール（頻度・時刻）は上の共通設定に従います。
      </p>

      {themes.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-4 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
          作業ディレクトリを設定したプロジェクトがありません。テーマに作業ディレクトリを設定すると、ここでプロジェクト別の設定ができます。
        </p>
      ) : (
        <div className="space-y-3">
          {themes.map((theme) => (
            <div
              key={theme.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="mb-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {theme.name}
              </div>
              <div className="space-y-2">
                {PROJECT_JOBS.map((job) => {
                  const ov = overrides.get(keyOf(job.kind, theme.id));
                  const enabled = ov ? ov.enabled : job.defaultEnabled;
                  const Icon = job.icon;
                  return (
                    <div key={job.kind}>
                      <div className="flex items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 ${job.color}`} />
                        <span className="text-xs text-zinc-700 dark:text-zinc-300">{job.label}</span>
                        <span className="ml-auto">
                          <Toggle
                            on={enabled}
                            onClick={() => patch(job.kind, theme.id, { enabled: !enabled })}
                          />
                        </span>
                      </div>
                      {/* health_check log source config */}
                      {job.hasLogConfig && enabled && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 pl-5">
                          <input
                            defaultValue={ov?.logDir ?? ''}
                            onBlur={(e) => patch(job.kind, theme.id, { logDir: e.target.value })}
                            placeholder="ログ出力ディレクトリ (例: C:\\proj\\logs)"
                            className="min-w-[16rem] flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-sky-400 dark:border-zinc-700"
                          />
                          <select
                            value={ov?.logFormat ?? 'text'}
                            onChange={(e) =>
                              patch(job.kind, theme.id, { logFormat: e.target.value as LogFormat })
                            }
                            className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
                          >
                            {LOG_FORMATS.map((f) => (
                              <option key={f.value} value={f.value}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
