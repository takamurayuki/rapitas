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
import { useTranslations } from 'next-intl';
import { Sparkles, Bug, Activity, Loader2, FolderCog } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { DirectoryPicker } from '@/components/ui/DirectoryPicker';

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

// NOTE: `label` text moved to i18n (backlog.projectOverrides.jobs.<kind>); look
// it up with `t(\`jobs.${kind}\`)` at each render site.
const PROJECT_JOBS: {
  kind: JobKind;
  icon: typeof Sparkles;
  color: string;
  defaultEnabled: boolean;
  hasLogConfig?: boolean;
}[] = [
  { kind: 'innovation', icon: Sparkles, color: 'text-amber-500', defaultEnabled: true },
  { kind: 'vuln_scan', icon: Bug, color: 'text-rose-500', defaultEnabled: true },
  {
    kind: 'health_check',
    icon: Activity,
    color: 'text-sky-500',
    defaultEnabled: false,
    hasLogConfig: true,
  },
];

const LOG_FORMAT_VALUES: LogFormat[] = ['pino', 'json', 'text'];

/** Small on/off switch matching the global settings toggle. */
function Toggle({
  on,
  onClick,
  disabled,
  ariaLabel,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
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
  const t = useTranslations('backlog');
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const { showToast } = useToast();

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
      // Optimistic update — captured for revert; without the revert a failed
      // PATCH left the toggle showing a state the server never accepted.
      let before: Map<string, Override> = new Map();
      setOverrides((prev) => {
        before = prev;
        const next = new Map(prev);
        const cur = next.get(key) ?? {
          kind,
          themeId,
          enabled: true,
          logDir: null,
          logFormat: null,
        };
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
        } else {
          setOverrides(before);
          showToast(t('projectOverrides.updateFailed'), 'error');
        }
      } catch {
        setOverrides(before);
        showToast(t('projectOverrides.updateFailed'), 'error');
      }
    },
    [showToast, t],
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
        {t('projectOverrides.title')}
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
        {t('projectOverrides.subtitle')}
      </p>

      {themes.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-4 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
          {t('projectOverrides.noThemes')}
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
                        <span className="text-xs text-zinc-700 dark:text-zinc-300">
                          {t(`projectOverrides.jobs.${job.kind}`)}
                        </span>
                        <span className="ml-auto">
                          <Toggle
                            on={enabled}
                            onClick={() => patch(job.kind, theme.id, { enabled: !enabled })}
                            ariaLabel={t(`projectOverrides.jobs.${job.kind}`)}
                          />
                        </span>
                      </div>
                      {/* health_check log source config */}
                      {job.hasLogConfig && enabled && (
                        <div className="mt-2 space-y-2 pl-5">
                          <DirectoryPicker
                            value={ov?.logDir ?? ''}
                            onChange={(path) => patch(job.kind, theme.id, { logDir: path })}
                            placeholder={t('projectOverrides.logDirPlaceholder')}
                          />
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {t('projectOverrides.logFormatLabel')}
                            </span>
                            <select
                              value={ov?.logFormat ?? 'text'}
                              onChange={(e) =>
                                patch(job.kind, theme.id, {
                                  logFormat: e.target.value as LogFormat,
                                })
                              }
                              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
                            >
                              {LOG_FORMAT_VALUES.map((f) => (
                                <option key={f} value={f}>
                                  {t(`projectOverrides.logFormats.${f}`)}
                                </option>
                              ))}
                            </select>
                          </div>
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
