/**
 * check-catalog/failure-hints
 *
 * Fills each check with what the implementer needs to fix it (task 1602):
 * the files the failure points at, what the real gate reports, and a hint on
 * how to fix it. Not responsible for judging pass/fail.
 */
import type { VerificationCheck } from '../verification-check-types';
import { catalogEntry } from './catalog';

/** Same cap as the job store keeps per check. */
const MAX_FAILURE_FILES = 200;

const PATH_TOKEN_RE = /[\w.@\\/:-]+\.[A-Za-z0-9]+/g;

const norm = (p: string) => p.replace(/\\/g, '/');

/** Path-like tokens in a check's details, made relative to the worktree. */
function pathTokens(details: string, workdir: string | undefined): string[] {
  const prefix = workdir ? `${norm(workdir).replace(/\/+$/, '')}/` : null;
  const out: string[] = [];
  for (const m of details.matchAll(PATH_TOKEN_RE)) {
    let t = norm(m[0]).replace(/[.:]+$/, '');
    if (prefix && t.toLowerCase().startsWith(prefix.toLowerCase())) t = t.slice(prefix.length);
    out.push(t.replace(/^\.\//, ''));
  }
  return out;
}

/**
 * The changed files a failing check points at.
 *
 * @param check - A failing check / 失敗した検査
 * @param allChanged - Every changed path / 全変更パス
 * @param workdir - Worktree root, stripped from absolute paths / worktree ルート
 * @returns Repo-relative files / リポジトリ相対のファイル
 */
export function extractFailureFiles(
  check: VerificationCheck,
  allChanged: string[],
  workdir?: string,
): string[] {
  const changed = allChanged.map(norm);
  if (check.failureFiles && check.failureFiles.length > 0) return check.failureFiles;
  if (check.offendingFiles && check.offendingFiles.length > 0) return check.offendingFiles;
  const tokens = pathTokens(check.details, workdir);
  const hits = changed.filter((f) =>
    tokens.some((t) => t === f || f.endsWith(`/${t}`) || t.endsWith(`/${f}`)),
  );
  return (hits.length > 0 ? hits : changed).slice(0, MAX_FAILURE_FILES);
}

/**
 * Attach `gateMessage` / `fixHint` to every check and `failureFiles` to every
 * failing one. Mutates and returns the same array.
 *
 * @param checks - Checks of one verification run / 1回の検証の検査
 * @param allChanged - Every changed path / 全変更パス
 * @param workdir - Worktree root / worktree ルート
 * @returns The same checks / 同じ配列
 */
export function attachFailureHints(
  checks: VerificationCheck[],
  allChanged: string[],
  workdir?: string,
): VerificationCheck[] {
  for (const check of checks) {
    const entry = catalogEntry(check.name);
    if (entry) {
      check.gateMessage = entry.gateMessage;
      check.fixHint = entry.fixHint;
    }
    if (!check.ok) check.failureFiles = extractFailureFiles(check, allChanged, workdir);
  }
  return checks;
}
