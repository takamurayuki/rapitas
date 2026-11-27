/**
 * auto-run-scope-overlap
 *
 * Pure file-overlap checks between a candidate's plan files and the changed files of open auto-PRs
 * (task 573 B). Split out of auto-run-selection.ts (file-size limit) and re-exported there.
 */

/**
 * Path-boundary-safe file match: equal, or one is the other's `/`-suffix.
 * Suffix matching absorbs repo-relative vs package-relative depth differences
 * (`rapitas-backend/services/a.ts` vs `services/a.ts`) without the false
 * positive of a bare endsWith (`foo/ab.ts` must NOT match `b.ts`).
 */
function fileMatches(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * Open-PR files that overlap the plan's file list (task 573 B). Both sides are
 * normalized to `/` separators; plan DIRECTORY tokens (trailing `/`) are
 * excluded on purpose — directory-granularity matching on shared dirs like
 * `services/` would defer every candidate and starve the theme. Pure.
 *
 * @param planFiles - parsePlanFiles output for a candidate's plan / 計画のファイル一覧
 * @param openPrFiles - Union of open auto-PR changed files / オープンPRの変更ファイル
 * @returns The overlapping open-PR file paths (deduped) / 重複ファイル一覧
 */
export function overlappingFiles(planFiles: string[], openPrFiles: string[]): string[] {
  const plan = planFiles
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f.length > 0 && !f.endsWith('/'));
  const out = new Set<string>();
  for (const prFile of openPrFiles) {
    const pr = prFile.replace(/\\/g, '/');
    if (plan.some((p) => fileMatches(p, pr))) out.add(pr);
  }
  return [...out];
}

/**
 * Whether a candidate's plan files overlap any open auto-PR's changed files.
 * Pure wrapper over {@link overlappingFiles}.
 *
 * @param planFiles - parsePlanFiles output for a candidate's plan / 計画のファイル一覧
 * @param openPrFiles - Union of open auto-PR changed files / オープンPRの変更ファイル
 * @returns True when at least one file overlaps / 重複があればtrue
 */
export function hasScopeOverlap(planFiles: string[], openPrFiles: string[]): boolean {
  return overlappingFiles(planFiles, openPrFiles).length > 0;
}
