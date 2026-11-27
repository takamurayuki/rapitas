/**
 * import-relation
 *
 * Decides whether one task's planned files import the other task's planned
 * files through a relative import (task 1552, "近い場所"). Reads the files from
 * the repository working directory; a file that cannot be read (new, moved)
 * counts as "no relation". Not responsible for bare-package imports or aliases.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../../../../config/logger';

const log = createLogger('parallel-import-relation');

/** Files read per task at most — bounds the cost on a large plan. */
export const MAX_IMPORT_SCAN_FILES = 50;

const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const IMPORT_RE = /(?:from\s+|import\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts'];

/** File reader, injectable for tests; returns null when unreadable. */
export type SourceReader = (absPath: string) => Promise<string | null>;

/**
 * Wrap a reader so each file is read at most once per `ttlMs`. Unreadable
 * files (null) are remembered too.
 *
 * @param base - Underlying reader / 元の読み込み関数
 * @param ttlMs - How long a result is reused / 結果を使い回す時間
 * @param now - Clock (tests) / 時計
 * @returns Cached reader / キャッシュ付きの読み込み関数
 */
export function createCachedReader(
  base: SourceReader,
  ttlMs: number,
  now: () => number = Date.now,
): SourceReader {
  const cache = new Map<string, { at: number; source: string | null }>();
  return async (absPath) => {
    const hit = cache.get(absPath);
    if (hit && now() - hit.at < ttlMs) return hit.source;
    const source = await base(absPath);
    cache.set(absPath, { at: now(), source });
    return source;
  };
}

// NOTE: Cached for 60 s. The check runs for every candidate pair on every 12 s
// selection tick and re-read up to 50 files per side each time, holding the
// backend near one core on 2026-11-27. Planned files change only on merges.
const defaultReader: SourceReader = createCachedReader(
  (absPath) => readFile(absPath, 'utf8').catch(() => null),
  60_000,
);

const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '');

function sameFile(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Relative import specifiers of one source text.
 *
 * @param source - File content / ファイル内容
 * @returns Specifiers starting with `./` or `../` / 相対 import の指定子
 */
export function relativeImports(source: string): string[] {
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

async function importsOf(
  cwd: string,
  files: string[],
  read: SourceReader,
): Promise<Array<{ from: string; to: string[] }>> {
  const out: Array<{ from: string; to: string[] }> = [];
  for (const file of files.filter((f) => SOURCE_RE.test(f)).slice(0, MAX_IMPORT_SCAN_FILES)) {
    const source = await read(path.join(cwd, file));
    if (source == null) {
      log.warn({ file }, 'planned file unreadable — treated as no import relation');
      continue;
    }
    const dir = path.posix.dirname(norm(file));
    const to = relativeImports(source).flatMap((spec) => {
      const base = path.posix.normalize(path.posix.join(dir, spec));
      return RESOLVE_SUFFIXES.map((s) => `${base}${s}`);
    });
    out.push({ from: norm(file), to });
  }
  return out;
}

/**
 * Whether a file of `a` relatively imports a file of `b`, or the reverse.
 *
 * @param cwd - Repository working directory / リポジトリの作業ディレクトリ
 * @param a - Planned files of one task (repo-relative) / 片方の計画ファイル
 * @param b - Planned files of the other task / もう片方の計画ファイル
 * @param read - File reader (tests) / ファイル読み込み
 * @returns The first relation found, or null / 見つかった関係
 */
export async function findImportRelation(
  cwd: string,
  a: string[],
  b: string[],
  read: SourceReader = defaultReader,
): Promise<{ from: string; to: string } | null> {
  for (const [src, dst] of [
    [a, b],
    [b, a],
  ] as const) {
    const targets = dst.map(norm);
    for (const entry of await importsOf(cwd, src.map(norm), read)) {
      const hit = targets.find((t) => entry.to.some((resolved) => sameFile(resolved, t)));
      if (hit) return { from: entry.from, to: hit };
    }
  }
  return null;
}
