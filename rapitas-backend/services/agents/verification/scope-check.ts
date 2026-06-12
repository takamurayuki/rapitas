/**
 * scope-check
 *
 * Mechanically enforces the plan's file scope: compares the agent's FULL git
 * diff against the files listed in plan.md and fails the verification gate on
 * out-of-plan changes. Until now scope was prompt-instructed only ("do not
 * modify files outside the plan") — the most frequently broken constraint.
 * Skips entirely when there is no plan (lightweight mode) or the plan lists no
 * parseable paths (fail-open: a prose-only plan must not block everything).
 * Not responsible for running git or rendering reports.
 */
import type { VerificationCheck } from './automated-verifier';

/** Always-acceptable changes (mechanical side effects of legitimate work). */
const SCOPE_ALLOWLIST = new Set([
  'bun.lock',
  'bun.lockb',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
]);

/** Path-like token: contains a slash or a dot-extension, no spaces. */
const PATHISH_RE = /^[\w.@-]+(?:[/\\][\w.@[\]-]+)*\.[A-Za-z]{1,6}$/;

/**
 * Extracts file paths referenced in plan.md. Sources: backtick-quoted tokens
 * (`path/to/file.ts`, optionally with a `:line` suffix) — the format both the
 * planner template and COMMENT_POLICY mandate. Pure and unit-testable.
 *
 * @param planContent - plan.md text / plan.md の内容
 * @returns Unique normalized (forward-slash) paths / 正規化済みパス一覧
 */
export function parsePlanFiles(planContent: string): string[] {
  const out = new Set<string>();
  for (const m of planContent.matchAll(/`([^`\n]+)`/g)) {
    // Strip :line / :line:col suffixes (`path/file.ts:123`).
    const token = m[1].trim().replace(/:(\d+)(:\d+)?$/, '');
    const normalized = token.replace(/\\/g, '/');
    if (PATHISH_RE.test(normalized)) out.add(normalized);
  }
  return [...out];
}

/**
 * Whether a changed file is covered by the plan's file list. Plans write paths
 * at varying depths (repo-relative vs package-relative), so a changed file
 * matches when it equals a plan path, ends with `/<plan path>`, or — for
 * bare-filename plan tokens — shares the basename.
 */
function isInPlan(changedFile: string, planFiles: string[]): boolean {
  const changed = changedFile.replace(/\\/g, '/');
  const changedBase = changed.split('/').pop() ?? changed;
  for (const plan of planFiles) {
    if (changed === plan) return true;
    if (plan.includes('/')) {
      if (changed.endsWith(`/${plan}`) || plan.endsWith(`/${changed}`)) return true;
    } else if (changedBase === plan) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates the out-of-plan check.
 *
 * @param allChangedFiles - EVERY changed path in the worktree (code or not) / 全変更ファイル
 * @param planFiles - Paths parsed from plan.md / plan.md記載のパス
 * @returns A check result, or null when not applicable (no plan paths) / 判定結果
 */
export function evaluateScopeCheck(
  allChangedFiles: string[],
  planFiles: string[],
): VerificationCheck | null {
  if (planFiles.length === 0) return null;

  const offending = allChangedFiles.filter((f) => {
    const base = f.replace(/\\/g, '/').split('/').pop() ?? f;
    if (SCOPE_ALLOWLIST.has(base)) return false;
    return !isInPlan(f, planFiles);
  });

  if (offending.length === 0) {
    return {
      name: 'scope',
      ran: true,
      ok: true,
      errorCount: 0,
      details: 'scope: all changes are within the plan',
    };
  }
  return {
    name: 'scope',
    ran: true,
    ok: false,
    errorCount: offending.length,
    details:
      `plan.md に記載のないファイルが変更されています（計画外変更）。` +
      `該当ファイルを revert するか、計画の意図に含まれるなら plan.md に追記してください:\n` +
      offending.slice(0, 40).join('\n'),
  };
}
