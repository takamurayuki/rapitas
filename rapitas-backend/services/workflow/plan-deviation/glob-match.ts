/**
 * plan-deviation/glob-match
 *
 * Dependency-free path normalization and glob / directory-prefix matching for
 * judging file changes against declared patterns. Pure functions only.
 */

/** Characters that make a declared pattern a glob rather than a literal path. */
const GLOB_CHARS_RE = /[*?]/;

/** Absolute path: POSIX root or a Windows drive letter (after normalization). */
const ABSOLUTE_RE = /^(?:\/|[a-z]:\/)/;

/**
 * Normalize a path for comparison: `\` → `/`, lower-case, strip a leading
 * `./`, and strip the working-directory prefix when given.
 *
 * @param raw - Raw path (relative or absolute, any separator) / 生のパス
 * @param workDir - Working directory whose prefix is removed / 作業ディレクトリ
 * @returns Normalized forward-slash lower-case path / 正規化済みパス
 */
export function normalizePath(raw: string, workDir?: string | null): string {
  let p = raw.trim().replace(/\\/g, '/').toLowerCase();
  if (workDir) {
    const base = workDir.trim().replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    // The leftover leading `/` after stripping is not a root — drop it.
    if (base && (p === base || p.startsWith(`${base}/`))) p = p.slice(base.length + 1);
  }
  while (p.startsWith('./')) p = p.slice(2);
  return p.replace(/\/{2,}/g, '/');
}

/** Translate one glob pattern into an anchored RegExp. */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more whole directories; a bare `**` matches anything.
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

/** Whether one already-normalized relative path matches one normalized pattern. */
function matchesNormalized(path: string, pattern: string): boolean {
  if (!pattern) return false;
  if (GLOB_CHARS_RE.test(pattern)) return globToRegExp(pattern).test(path);
  const dir = pattern.replace(/\/+$/, '');
  // A literal pattern is either the exact file or a directory prefix.
  return path === dir || path.startsWith(`${dir}/`);
}

/**
 * Whether a changed file path matches a declared pattern.
 *
 * Absolute paths that could not be made relative (unknown workDir) are tried
 * at every segment boundary, so `C:/…/.worktrees/x/rapitas-backend/a.ts`
 * still matches `rapitas-backend/**`.
 *
 * @param path - Changed file path / 変更されたファイルのパス
 * @param pattern - Declared glob / directory / file pattern / 宣言パターン
 * @param workDir - Working directory of the execution / 実行の作業ディレクトリ
 * @returns True when the path is covered by the pattern / 一致すれば true
 */
export function matchesPattern(path: string, pattern: string, workDir?: string | null): boolean {
  const normalizedPattern = normalizePath(pattern).replace(/^\/+/, '');
  const normalizedPath = normalizePath(path, workDir);
  if (!ABSOLUTE_RE.test(normalizedPath)) {
    return matchesNormalized(normalizedPath.replace(/^\/+/, ''), normalizedPattern);
  }
  const segments = normalizedPath
    .replace(/^[a-z]:\//, '')
    .replace(/^\//, '')
    .split('/');
  for (let i = 0; i < segments.length; i++) {
    if (matchesNormalized(segments.slice(i).join('/'), normalizedPattern)) return true;
  }
  return false;
}

/**
 * Whether a path matches any of the declared patterns.
 *
 * @param path - Changed file path / 変更されたファイルのパス
 * @param patterns - Declared patterns / 宣言パターン一覧
 * @param workDir - Working directory of the execution / 作業ディレクトリ
 * @returns True when at least one pattern matches / いずれかに一致すれば true
 */
export function matchesAnyPattern(
  path: string,
  patterns: readonly string[],
  workDir?: string | null,
): boolean {
  return patterns.some((p) => matchesPattern(path, p, workDir));
}
