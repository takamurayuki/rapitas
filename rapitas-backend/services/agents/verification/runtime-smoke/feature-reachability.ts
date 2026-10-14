/**
 * runtime-smoke/feature-reachability
 *
 * Decides whether each declared feature has an entry point (file + optional
 * marker) in the shipped worktree, and folds that into the smoke verdict.
 * It is NOT a click-through check: a present entry is a necessary, not
 * sufficient, condition for a user reaching the feature.
 */
import { readFile, realpath } from 'fs/promises';
import { isAbsolute, resolve, sep } from 'path';

/** One declared feature entry point. */
export interface FeatureEntry {
  /** Feature id, normalized to upper case (e.g. "F-01"). */
  id: string;
  /** Path relative to the worktree root. */
  file: string;
  /** Text that must appear in the file (optional). */
  marker?: string;
}

/** Reader result: file content, null when absent, or an I/O error message. */
export type EntryReader = (file: string) => Promise<{ content: string | null; error?: string }>;

/** Reachability verdict. */
export interface ReachabilityResult {
  status: 'reachable' | 'unreachable' | 'unknown';
  present: string[];
  missing: string[];
  reason?: string;
}

/** Smoke verdict shape that reachability is composed into. */
export interface SmokeVerdict {
  ok: boolean;
  errorCount: number;
  lines: string[];
}

const MAX_FEATURE_ENTRIES = 50;

/**
 * Parse and validate a `featureEntries` declaration.
 *
 * @param raw - Raw JSON value / 設定の生の値
 * @returns Entries (absent when undeclared) or an error / 解析結果またはエラー
 */
export function parseFeatureEntries(raw: unknown): { entries?: FeatureEntry[]; error?: string } {
  if (raw === undefined) return {};
  if (!Array.isArray(raw)) return { error: '"featureEntries" must be an array' };
  if (raw.length > MAX_FEATURE_ENTRIES) {
    return { error: `"featureEntries" allows at most ${MAX_FEATURE_ENTRIES} items` };
  }
  const seen = new Set<string>();
  const entries: FeatureEntry[] = [];
  for (const item of raw) {
    const o = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof o.id !== 'string' || o.id.trim() === '') {
      return { error: '"featureEntries[].id" must be a non-empty string' };
    }
    if (typeof o.file !== 'string' || o.file.trim() === '') {
      return { error: '"featureEntries[].file" must be a non-empty string' };
    }
    const file = o.file.trim();
    const unsafe =
      isAbsolute(file) ||
      /^[a-zA-Z]:/.test(file) ||
      file.startsWith('/') ||
      file.split(/[\/]/).includes('..');
    if (unsafe) {
      return {
        error: `"featureEntries[].file" must be a relative path inside the project: ${file}`,
      };
    }
    if (o.marker !== undefined && (typeof o.marker !== 'string' || o.marker === '')) {
      return { error: '"featureEntries[].marker" must be a non-empty string' };
    }
    const id = o.id.trim().toUpperCase();
    if (seen.has(id)) return { error: `"featureEntries" has a duplicate id: ${id}` };
    seen.add(id);
    entries.push({ id, file, ...(typeof o.marker === 'string' ? { marker: o.marker } : {}) });
  }
  return { entries };
}

/**
 * Pure reachability verdict; file access is injected.
 *
 * @param entries - Declared entries / 宣言された入口
 * @param read - File reader / ファイル読み出し関数
 * @returns Verdict with present and missing feature ids / 判定結果
 */
export async function evaluateFeatureReachability(
  entries: FeatureEntry[] | undefined,
  read: EntryReader,
): Promise<ReachabilityResult> {
  if (!entries || entries.length === 0) {
    return {
      status: 'unknown',
      present: [],
      missing: [],
      reason: entries ? 'featureEntries が 0 件' : 'featureEntries が未宣言',
    };
  }
  const present: string[] = [];
  const missing: string[] = [];
  const errored: string[] = [];
  for (const e of entries) {
    const r = await read(e.file);
    if (r.error) errored.push(e.id);
    else if (r.content === null || r.content.trim() === '') missing.push(e.id);
    else if (e.marker && !r.content.includes(e.marker)) missing.push(e.id);
    else present.push(e.id);
  }
  if (missing.length > 0) return { status: 'unreachable', present, missing };
  if (errored.length > 0) {
    return {
      status: 'unknown',
      present,
      missing,
      reason: `入口ファイルを読み出せない: ${errored.join(', ')}`,
    };
  }
  return { status: 'reachable', present, missing };
}

/**
 * Build a reader confined to the worktree (symlink escapes count as absent).
 *
 * @param workdir - Worktree root / worktree ルート
 * @returns Reader bound to the worktree / 束縛済みリーダー
 */
export function createWorkdirReader(workdir: string): EntryReader {
  return async (file) => {
    try {
      const root = await realpath(workdir);
      const target = await realpath(resolve(root, file));
      if (target !== root && !target.startsWith(root + sep)) return { content: null };
      return { content: await readFile(target, 'utf8') };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return { content: null };
      return { content: null, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

/**
 * Fold reachability into a smoke verdict. ok is only ever AND-ed down.
 *
 * @param verdict - Smoke verdict / スモーク判定
 * @param cfg - Runtime config carrying featureEntries / 設定
 * @param workdir - Worktree root / worktree ルート
 * @param reader - Reader override (tests) / テスト用リーダー
 * @returns Composed verdict / 合成後の判定
 */
export async function applyFeatureReachability(
  verdict: SmokeVerdict,
  cfg: { featureEntries?: FeatureEntry[] },
  workdir: string,
  reader: EntryReader = createWorkdirReader(workdir),
): Promise<SmokeVerdict> {
  const r = await evaluateFeatureReachability(cfg.featureEntries, reader);
  if (r.status === 'unreachable') {
    return {
      ok: false,
      errorCount: verdict.errorCount + r.missing.length,
      lines: [...verdict.lines, `✗ 到達不能な機能: ${r.missing.join(', ')}`],
    };
  }
  if (r.status === 'unknown') {
    return { ...verdict, lines: [...verdict.lines, `到達性: 判定不能（${r.reason}）`] };
  }
  const n = r.present.length;
  return { ...verdict, lines: [...verdict.lines, `✓ 入口確認: ${n}/${n} 機能`] };
}
