/**
 * automated-verifier
 *
 * Orchestrates REAL lint + typecheck + format + scoped-test verification
 * against an agent's worktree changes and aggregates the results into a single
 * verdict — the individual check implementations live in the verifier-* /
 * verification-types modules (file-size split) and are re-exported here so
 * existing importers keep working. Scoped to the agent's changed files so
 * pre-existing problems in the project don't cause false gating.
 * Monorepo-aware: groups changed files by the nearest package.json and runs
 * the tooling per project root.
 *
 * All subprocesses run ASYNChronously (spawn) — never execSync — so a slow
 * tsc/eslint can't block the single-threaded backend event loop.
 *
 * Optionally also runs the project's test suite (opt-in via RAPITAS_VERIFY_TESTS)
 * so the gate covers runtime breakage, not just lint/types. Not responsible for
 * committing or the retry loop.
 */
import { createLogger } from '../../../config/logger';
import { parsePlanFiles, evaluateScopeCheck } from './scope-check';
import { evaluateAcceptanceSelfCheck } from './acceptance-self-check';
import type { VerificationCheck, VerificationResult } from './verification-types';
import { MAX_DETAIL_CHARS } from './verifier-exec';
import { getAllChangedFiles, getChangedCodeFiles, groupByProjectRoot } from './verifier-diff-scope';
import { lintProject } from './verifier-lint';
import { formatProject } from './verifier-format';
import { typecheckProject } from './verifier-typecheck';
import { testProject } from './verifier-test-check';
import { tamperCheck, coverageCheck, generatedSyncCheck } from './verifier-gates';

const log = createLogger('agents:automated-verifier');

/** Merges per-project checks of the same kind into one aggregate check. */
export function mergeChecks(
  name: 'lint' | 'typecheck' | 'test' | 'format',
  parts: VerificationCheck[],
): VerificationCheck {
  const unverifiable = parts.filter((p) => p.unverifiable);
  const ran = parts.filter((p) => p.ran);
  if (ran.length === 0 && unverifiable.length === 0) {
    return { name, ran: false, ok: true, errorCount: 0, details: `${name}: not applicable` };
  }
  const errorCount = ran.reduce((s, p) => s + p.errorCount, 0);
  // Any unverifiable part fails the merged check (fail closed).
  const ok = unverifiable.length === 0 && errorCount === 0;
  const details = [
    ...unverifiable.map((p) => p.details),
    ...ran.filter((p) => !p.ok).map((p) => p.details),
  ]
    .join('\n\n')
    .slice(0, MAX_DETAIL_CHARS);
  // Aggregate pre-existing failures across all project parts (only set for 'test').
  const allPreExisting = parts.flatMap((p) => p.preExistingFailures ?? []);
  const allIndeterminate = parts.flatMap((p) => p.indeterminateFailures ?? []);
  return {
    name,
    ran: ran.length > 0,
    ok,
    errorCount,
    details: details || `${name}: ok`,
    unverifiable: unverifiable.length > 0 || undefined,
    preExistingFailures: allPreExisting.length > 0 ? allPreExisting : undefined,
    indeterminate: parts.some((p) => p.indeterminate) || undefined,
    indeterminateFailures: allIndeterminate.length > 0 ? allIndeterminate : undefined,
  };
}

/** Optional inputs for {@link runAutomatedVerification}. */
export interface VerificationOptions {
  /**
   * plan.md content; when provided (and it lists parseable paths) the gate also
   * fails on out-of-plan file changes. Omit in plan-less (lightweight) mode.
   */
  planContent?: string | null;
  /**
   * Force the coverage gate for this run (bug-fix tasks must ship a
   * reproducing test) regardless of the RAPITAS_REQUIRE_TESTS env opt-in.
   */
  requireTests?: boolean;
  /**
   * The branch this task's worktree was actually cut from (e.g.
   * `AgentExecutionConfig.targetBranch`), tried before the develop/main/master
   * guess when resolving the diff base. See diffBaseRef's doc comment.
   */
  preferredBaseBranch?: string | null;
  /**
   * Task whose Theme's runtimeConfigJson the runtime-smoke stage should
   * prefer over a rapitas.runtime.json file, if set. See
   * runtime-config.ts's resolveRuntimeConfig.
   */
  taskId?: number;
  /**
   * The task's acceptance criteria; when non-empty the ADVISORY acceptance
   * self-check matches each criterion against the changed files (task 617 —
   * bounce classes A/B were 44% of verify bounces). Omit to skip the check.
   */
  acceptanceCriteria?: string[];
  /**
   * Task title + description, used by the acceptance self-check's
   * unrelated-diff (608-type) detection alongside the criteria tokens.
   */
  taskText?: string;
}

/**
 * Overall verdict across checks. 'scope' and 'acceptance' are ADVISORY — both
 * are token-matching heuristics whose false positives must not block a
 * genuinely green change (see the NOTE above the staticOk call site; scope's
 * hard→advisory demotion history is task 298). Exported for unit tests that
 * pin the advisory exclusion.
 *
 * @param checks - Individual check results. / 各チェック結果
 * @returns Hard-gate verdict. / 総合判定
 */
export function computeOverallOk(checks: VerificationCheck[]): boolean {
  return checks.filter((c) => c.name !== 'scope' && c.name !== 'acceptance').every((c) => c.ok);
}

/**
 * Runs automated lint + typecheck + scoped-test (+ plan-scope) verification on
 * an agent's worktree.
 *
 * @param workdir - The agent's git worktree path / エージェントの worktree パス
 * @param options - Optional plan content for the scope check / scope判定用plan
 * @returns Structured verification result / 構造化された検証結果
 */
export async function runAutomatedVerification(
  workdir: string,
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  const changedFiles = await getChangedCodeFiles(workdir, options.preferredBaseBranch);

  // Full-diff views (not just code files): scope violations and gate tampering
  // can live in docs/config/CI files too.
  const allChanged = await getAllChangedFiles(workdir, options.preferredBaseBranch);
  const planFiles = options.planContent ? parsePlanFiles(options.planContent) : null;

  // Plan-scope check (advisory) — only meaningful when a plan exists.
  const scopeCheck: VerificationCheck | null =
    options.planContent && planFiles ? evaluateScopeCheck(allChanged, planFiles) : null;

  // Anti-tampering tripwire (HARD gate) — always evaluated, even when no code
  // file changed (a CI/hook-only diff is exactly the case it must catch).
  const tamper = tamperCheck(allChanged, planFiles);

  if (changedFiles.length === 0 && (!scopeCheck || scopeCheck.ok) && (!tamper || tamper.ok)) {
    return {
      ok: true,
      changedFiles: [],
      checks: [...(scopeCheck ? [scopeCheck] : []), ...(tamper ? [tamper] : [])],
      summary: '自動検証: 対象のコード変更なし',
      unverifiable: false,
    };
  }

  const groups = groupByProjectRoot(workdir, changedFiles);
  const lintParts: VerificationCheck[] = [];
  const typeParts: VerificationCheck[] = [];
  const testParts: VerificationCheck[] = [];
  const formatParts: VerificationCheck[] = [];
  for (const [projectRoot, relFiles] of groups) {
    const [lint, type, test, format] = await Promise.all([
      lintProject(projectRoot, workdir, relFiles),
      typecheckProject(projectRoot, workdir, relFiles),
      testProject(projectRoot, workdir, relFiles),
      formatProject(projectRoot, workdir, relFiles),
    ]);
    if (lint) lintParts.push(lint);
    if (type) typeParts.push(type);
    if (test) testParts.push(test);
    if (format) formatParts.push(format);
  }

  const coverage = coverageCheck(changedFiles, options.requireTests === true);
  // CI-parity checks: prettier formatting and Prisma generated-artifact sync
  // both hard-fail CI's Lint Code job, so catching them here turns a full
  // ci_repair round into an in-phase fix.
  const generatedSync = generatedSyncCheck(allChanged);
  // Acceptance self-check (ADVISORY, task 617): criterion↔diff token matching
  // over the FULL diff (criteria may reference docs/config, not just code).
  const acceptance =
    options.acceptanceCriteria && options.acceptanceCriteria.length > 0
      ? evaluateAcceptanceSelfCheck({
          criteria: options.acceptanceCriteria,
          changedFiles: allChanged,
          taskText: options.taskText ?? '',
        })
      : null;
  const checks = [
    mergeChecks('lint', lintParts),
    mergeChecks('typecheck', typeParts),
    mergeChecks('test', testParts),
    ...(formatParts.length > 0 ? [mergeChecks('format', formatParts)] : []),
    ...(generatedSync ? [generatedSync] : []),
    ...(scopeCheck ? [scopeCheck] : []),
    ...(tamper ? [tamper] : []),
    ...(coverage ? [coverage] : []),
    ...(acceptance ? [acceptance] : []),
  ];
  // Scope and acceptance are ADVISORY, not hard gates. A plan-scope deviation
  // while lint + typecheck + test are all green means the agent made valid,
  // working changes that merely touch a file the plan didn't list precisely
  // (e.g. a refactor's related caller). Hard-blocking on it stranded
  // legitimately-complete tasks and churned them forever (observed #298:
  // lint=ok/typecheck=ok/test=ok/scope=NG(1) → blocked, re-run, blocked…).
  // Acceptance shares the same weakness (Japanese criteria ↔ path token
  // matching), so it stays advisory too: the summary surfaces it to the
  // implementer, and adversarial-review + PR review still catch genuine
  // scope sprawl / unaddressed criteria. Gate on the CORRECTNESS checks only.
  const staticOk = computeOverallOk(checks);

  // Runtime smoke (Evaluator "actually run it" stage): only for projects that
  // opt in (Theme runtimeConfigJson or a rapitas.runtime.json file), and only
  // once the static checks pass — launching the app costs ~a minute and a
  // static failure bounces anyway. A runtime failure joins the same
  // verify-repair loop as any other check.
  if (staticOk) {
    try {
      const { runRuntimeSmokeCheck } = await import('./runtime-smoke');
      const runtime = await runRuntimeSmokeCheck(workdir, 'adhoc', options.taskId);
      if (runtime) checks.push(runtime);
    } catch (e) {
      log.warn({ err: e, workdir }, '[verify] runtime smoke stage crashed — skipping (fail-open)');
    }
  }

  const unverifiable = checks.some((c) => c.unverifiable);
  const ok = computeOverallOk(checks);
  const summary = checks
    .map((c) =>
      c.unverifiable
        ? `${c.name}=UNVERIFIED`
        : !c.ran
          ? `${c.name}=skip`
          : c.ok
            ? `${c.name}=ok`
            : `${c.name}=NG(${c.errorCount})`,
    )
    .join(' / ');

  return { ok, changedFiles, checks, summary: `自動検証: ${summary}`, unverifiable };
}

// NOTE: Check implementations moved to the verifier-* / verification-types
// modules (file-size split); re-exported here so existing importers keep working.
export type { VerificationCheck, VerificationResult } from './verification-types';
export { diffBaseRef, getAllChangedFiles } from './verifier-diff-scope';
export { parseEslintErrorCount } from './verifier-lint';
export { parseTscErrorFiles } from './verifier-typecheck';
export {
  looksLikeBugFixTask,
  tamperCheck,
  coverageCheck,
  generatedSyncCheck,
} from './verifier-gates';

// NOTE: Rendering moved to verification-report.ts (file-size split); re-exported
// here so existing importers keep working.
export { renderVerificationMarkdown } from './verification-report';
