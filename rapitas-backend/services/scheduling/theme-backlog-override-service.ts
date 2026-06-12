/**
 * theme-backlog-override-service
 *
 * CRUD + query helpers for per-theme (per-project) overrides of backlog jobs
 * (ThemeBacklogSchedule). Absence of a row = the job's global default applies.
 * The jobs read these to skip disabled themes (innovation/vuln_scan) or to find
 * which projects' logs to scan (health_check). Does not run anything.
 */
import { prisma } from '../../config/database';
import type { BacklogJobKind } from './backlog-schedule-service';

/** How a project's log files are formatted (drives the health_check parser). */
export type LogFormat = 'pino' | 'json' | 'text';

export interface ThemeOverride {
  kind: BacklogJobKind;
  themeId: number;
  enabled: boolean;
  /** health_check: directory to scan for the project's logs. */
  logDir: string | null;
  /** health_check: log format preset. */
  logFormat: LogFormat | null;
}

const VALID_FORMATS: readonly LogFormat[] = ['pino', 'json', 'text'];

/** Coerces a value to a valid log format (default 'text' — the safe fallback). */
export function normalizeLogFormat(value: unknown): LogFormat {
  return VALID_FORMATS.includes(value as LogFormat) ? (value as LogFormat) : 'text';
}

interface OverrideRow {
  kind: string;
  themeId: number;
  enabled: boolean;
  logDir: string | null;
  logFormat: string | null;
}

function toOverride(row: OverrideRow): ThemeOverride {
  return {
    kind: row.kind as BacklogJobKind,
    themeId: row.themeId,
    enabled: row.enabled,
    logDir: row.logDir,
    logFormat: row.logFormat ? normalizeLogFormat(row.logFormat) : null,
  };
}

/**
 * Lists every per-theme override (for the settings UI).
 *
 * @returns All override rows / 全上書き行
 */
export async function listThemeOverrides(): Promise<ThemeOverride[]> {
  const rows = await prisma.themeBacklogSchedule.findMany();
  return rows.map(toOverride);
}

/**
 * Theme ids explicitly DISABLED for a job kind (used to exclude them from a
 * default-on job like vuln_scan or innovation).
 *
 * @param kind - Job kind / ジョブ種別
 * @returns Set of disabled theme ids / 無効化されたテーマIDの集合
 */
export async function getDisabledThemeIds(kind: BacklogJobKind): Promise<Set<number>> {
  const rows = await prisma.themeBacklogSchedule.findMany({
    where: { kind, enabled: false },
    select: { themeId: true },
  });
  return new Set(rows.map((r) => r.themeId));
}

export interface HealthCheckTarget {
  themeId: number;
  logDir: string;
  logFormat: LogFormat;
}

/**
 * health_check targets: themes opted in with a log directory configured.
 *
 * @returns Enabled health_check overrides that have a logDir / ログ設定済みの対象
 */
export async function getHealthCheckTargets(): Promise<HealthCheckTarget[]> {
  const rows = await prisma.themeBacklogSchedule.findMany({
    where: { kind: 'health_check', enabled: true, NOT: { logDir: null } },
    select: { themeId: true, logDir: true, logFormat: true },
  });
  return rows
    .filter((r) => r.logDir && r.logDir.trim().length > 0)
    .map((r) => ({
      themeId: r.themeId,
      logDir: r.logDir as string,
      logFormat: normalizeLogFormat(r.logFormat),
    }));
}

/**
 * Creates or updates a per-theme override (only provided fields change).
 *
 * @param kind - Job kind / ジョブ種別
 * @param themeId - Theme id / テーマID
 * @param patch - Fields to set / 設定するフィールド
 * @returns The resulting override / 反映後の上書き
 */
export async function upsertThemeOverride(
  kind: BacklogJobKind,
  themeId: number,
  patch: { enabled?: boolean; logDir?: string | null; logFormat?: unknown },
): Promise<ThemeOverride> {
  const data: Record<string, unknown> = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.logDir !== undefined) data.logDir = patch.logDir?.trim() ? patch.logDir.trim() : null;
  if (patch.logFormat !== undefined) data.logFormat = normalizeLogFormat(patch.logFormat);

  const row = await prisma.themeBacklogSchedule.upsert({
    where: { kind_themeId: { kind, themeId } },
    create: {
      kind,
      themeId,
      enabled: patch.enabled ?? true,
      logDir: typeof data.logDir === 'string' ? (data.logDir as string) : null,
      logFormat: data.logFormat as string | undefined,
    },
    update: data,
  });
  return toOverride(row as OverrideRow);
}
