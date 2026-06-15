/**
 * theme-log-reader
 *
 * Resolves WHERE a theme's logs live and reads a bounded slice of raw log text
 * for the log-analysis dashboard. Environment-aware: prefers an explicitly
 * configured log directory (ThemeBacklogSchedule.logDir), else scans the theme's
 * working directory for log files, and degrades gracefully when nothing exists.
 * NOT responsible for parsing/format-detection — it returns RAW text so the rich
 * client analyzer can auto-detect among its many formats.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { normalizeLogFormat, type LogFormat } from '../scheduling/theme-backlog-override-service';

const log = createLogger('system:theme-log-reader');

/** Read at most this many bytes total (tail of the newest files). */
const MAX_BYTES = 512 * 1024; // 512 KB
/** Newest N files to consider. */
const MAX_FILES = 8;
/** Extensions treated as logs when scanning a working directory. */
const LOG_EXTS = new Set(['.log', '.ndjson', '.jsonl', '.json', '.txt', '.out', '.err']);
/** Subdirectories commonly holding logs, tried in order under the working dir. */
const LOG_SUBDIRS = ['logs', 'log', '.logs', 'var/log', 'tmp/logs'];

/** A theme selectable in the log dashboard (has a working directory). */
export interface LogTheme {
  id: number;
  name: string;
  workingDirectory: string;
  /** Explicitly configured log dir, if any. / 明示設定されたログdir */
  logDir: string | null;
  /** Configured format hint (pino/json/text). / 設定された形式ヒント */
  logFormat: LogFormat | null;
}

/** Where a read resolved its logs from. */
export type LogSourceKind = 'configured' | 'scanned' | 'none';

/** Result of reading a theme's logs. */
export interface ThemeLogRead {
  /** Raw concatenated log text (bounded). / 生ログ（上限付き） */
  content: string;
  /** How the directory was resolved. / 解決方法 */
  source: LogSourceKind;
  /** The directory actually read. / 実際に読んだディレクトリ */
  directory: string | null;
  /** Files read (newest first). / 読んだファイル */
  files: string[];
  /** Configured format hint for the UI. / UI向け形式ヒント */
  configuredFormat: LogFormat | null;
  /** True when output was truncated to the byte cap. / 上限で切詰めたか */
  truncated: boolean;
  /** Human-readable note (e.g. why empty). / 補足 */
  note?: string;
}

/** List themes that can have logs (a working directory is set). */
export async function listLogThemes(): Promise<LogTheme[]> {
  const themes = await prisma.theme.findMany({
    where: { workingDirectory: { not: null } },
    select: { id: true, name: true, workingDirectory: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });

  // One pass for all per-theme log config rows (any kind that set a logDir).
  const schedules = await prisma.themeBacklogSchedule
    .findMany({
      where: { NOT: { logDir: null } },
      select: { themeId: true, kind: true, logDir: true, logFormat: true },
    })
    .catch(
      () =>
        [] as { themeId: number; kind: string; logDir: string | null; logFormat: string | null }[],
    );

  const cfgByTheme = new Map<number, { logDir: string | null; logFormat: string | null }>();
  for (const s of schedules) {
    // Prefer the health_check row's config; otherwise keep the first seen.
    if (!cfgByTheme.has(s.themeId) || s.kind === 'health_check') {
      cfgByTheme.set(s.themeId, { logDir: s.logDir, logFormat: s.logFormat });
    }
  }

  return themes
    .filter(
      (t): t is { id: number; name: string; workingDirectory: string } => !!t.workingDirectory,
    )
    .map((t) => {
      const cfg = cfgByTheme.get(t.id);
      return {
        id: t.id,
        name: t.name,
        workingDirectory: t.workingDirectory,
        logDir: cfg?.logDir ?? null,
        logFormat: cfg?.logFormat ? normalizeLogFormat(cfg.logFormat) : null,
      };
    });
}

/** Candidate log files in a directory, newest first, log-ish extensions only. */
function logFilesIn(dir: string): { path: string; mtime: number; size: number }[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && LOG_EXTS.has(extname(e.name).toLowerCase()))
      .map((e) => {
        const p = join(dir, e.name);
        const st = statSync(p);
        return { path: p, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/**
 * Resolve the directory to read for a theme: the configured logDir if it exists,
 * else the first working-directory location that actually contains log files.
 */
function resolveDir(theme: LogTheme): { dir: string; source: LogSourceKind } | null {
  if (theme.logDir && theme.logDir.trim() && existsSync(theme.logDir)) {
    return { dir: theme.logDir, source: 'configured' };
  }
  const candidates = [
    ...LOG_SUBDIRS.map((sub) => join(theme.workingDirectory, sub)),
    theme.workingDirectory,
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && logFilesIn(dir).length > 0) {
      return { dir, source: 'scanned' };
    }
  }
  return null;
}

/** Read the tail of one file, up to `maxBytes`. */
function tailFile(path: string, maxBytes: number): string {
  try {
    const full = readFileSync(path, 'utf-8');
    return full.length > maxBytes ? full.slice(full.length - maxBytes) : full;
  } catch (err) {
    log.warn({ err, path }, '[theme-log-reader] Failed to read log file');
    return '';
  }
}

/**
 * Read a bounded slice of a theme's raw logs.
 *
 * @param themeId - Theme to read. / 読むテーマID
 * @returns Raw log text + provenance, or an empty result with a note. / 生ログと出所
 */
export async function readThemeLogs(themeId: number): Promise<ThemeLogRead> {
  const themes = await listLogThemes();
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) {
    return {
      content: '',
      source: 'none',
      directory: null,
      files: [],
      configuredFormat: null,
      truncated: false,
      note: 'テーマが見つからない、または作業ディレクトリが未設定です。',
    };
  }

  const resolved = resolveDir(theme);
  if (!resolved) {
    return {
      content: '',
      source: 'none',
      directory: null,
      files: [],
      configuredFormat: theme.logFormat,
      truncated: false,
      note: theme.logDir
        ? `設定されたログディレクトリが見つかりません: ${theme.logDir}`
        : 'ログが見つかりませんでした。バックログ設定でログ出力先を指定するか、ログを貼り付けてください。',
    };
  }

  const files = logFilesIn(resolved.dir).slice(0, MAX_FILES);
  let budget = MAX_BYTES;
  let truncated = false;
  const parts: string[] = [];
  const read: string[] = [];
  // Newest first; take the tail of each until the byte budget is exhausted.
  for (const f of files) {
    if (budget <= 0) {
      truncated = true;
      break;
    }
    const chunk = tailFile(f.path, budget);
    if (f.size > chunk.length) truncated = true;
    parts.push(`===== ${f.path} =====\n${chunk}`);
    read.push(f.path);
    budget -= chunk.length;
  }

  return {
    content: parts.join('\n\n'),
    source: resolved.source,
    directory: resolved.dir,
    files: read,
    configuredFormat: theme.logFormat,
    truncated,
  };
}
