/**
 * automated-verifier
 *
 * Runs REAL lint + typecheck against an agent's worktree changes and reports
 * whether the agent INTRODUCED any failures. Replaces prose-only verify.md
 * claims with actual command output. Scoped to the agent's changed files (and,
 * for tsc, errors are filtered to those files) so pre-existing problems in the
 * project don't cause false gating. Monorepo-aware: groups changed files by the
 * nearest package.json and runs the tooling per project root. All subprocesses
 * run ASYNChronously (spawn) — never execSync — so a slow tsc/eslint can't
 * block the single-threaded backend event loop. Optionally also runs the
 * project's test suite (opt-in via RAPITAS_VERIFY_TESTS) so the gate covers
 * runtime breakage, not just lint/types. Not responsible for committing or
 * the retry loop.
 *
 * NOTE: task 1602 split the per-check implementations into verifier-*.ts and
 * verification-check-types.ts (file-size limit). Everything they export is
 * re-exported below so existing importers and `mock.module` users keep working.
 */
import { generatedSyncCheck, ciParityChecks } from './generated-sync-check';
import { coverageCandidates } from './coverage-test-files';
import { parsePlanFiles, evaluateScopeCheck } from './scope-check';
import { evaluateAcceptanceSelfCheck } from './acceptance-self-check';
import { schemaChangeGateCheck, collectHardGateChecks } from './schema-change-gate';
import { resolveForbiddenChangeOverride } from './schema-change-gate';
import { runProjectChecks } from './quiet-verification';
import {
  getAllChangedFiles,
  getChangedCodeFiles,
  groupByProjectRoot,
} from './verifier-changed-files';
import { formatProject, lintProject, mergeChecks } from './verifier-project-lint';
import { testProject, typecheckProject } from './verifier-project-typecheck-test';
import { coverageCheck, tamperCheck } from './verifier-task-gates';
import type {
  VerificationCheck,
  VerificationOptions,
  VerificationResult,
} from './verification-check-types';

export { generatedSyncCheck } from './generated-sync-check';
export type {
  VerificationCheck,
  VerificationCheckName,
  VerificationOptions,
  VerificationResult,
} from './verification-check-types';
export { diffBaseRef, getAllChangedFiles, groupByProjectRoot } from './verifier-changed-files';
export {
  parseEslintErrorCount,
  lintProject,
  formatProject,
  mergeChecks,
} from './verifier-project-lint';
export {
  parseTscErrorFiles,
  typecheckProject,
  testProject,
} from './verifier-project-typecheck-test';
export {
  looksLikeBugFixTask,
  looksLikeTrivialTask,
  requiresTestsForTask,
  tamperCheck,
  coverageCheck,
} from './verifier-task-gates';

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
  // Full diff (not just code files): scope violations and tampering can live in docs/config/CI too.
  const allChanged = await getAllChangedFiles(workdir, options.preferredBaseBranch);
  const planFiles = options.planContent ? parsePlanFiles(options.planContent) : null;

  const scopeCheck: VerificationCheck | null =
    options.planContent && planFiles ? evaluateScopeCheck(allChanged, planFiles) : null;
  // Anti-tampering + schema-change (task 892) HARD gates — always evaluated,
  // even with no code file changed (a CI/hook-only diff is exactly the case).
  const allow = options.tamperAllowlist ?? [];
  const tamperPlan = allow.length ? [...(planFiles ?? []), ...allow] : planFiles;
  const tamper = tamperCheck(allChanged, tamperPlan);
  const forbiddenChangeOverride = await resolveForbiddenChangeOverride(options.taskId);
  const schemaGate = schemaChangeGateCheck(allChanged, planFiles, forbiddenChangeOverride);
  const hardGateChecks = collectHardGateChecks(scopeCheck, tamper, schemaGate);
  // An empty diff skips scoped static commands, but does not prove that a
  // configured runtime works (for example after restoring a merged task).
  // Continue to the runtime stage and preserve unavailable/failed evidence.
  const groups = groupByProjectRoot(workdir, changedFiles);
  const lintParts: VerificationCheck[] = [];
  const typeParts: VerificationCheck[] = [];
  const testParts: VerificationCheck[] = [];
  const formatParts: VerificationCheck[] = [];
  for (const [projectRoot, relFiles] of groups) {
    const [lint, type, test, format] = await runProjectChecks({
      lint: () => lintProject(projectRoot, workdir, relFiles),
      type: () => typecheckProject(projectRoot, workdir, relFiles),
      test: () => testProject(projectRoot, workdir, relFiles),
      format: () => formatProject(projectRoot, workdir, relFiles),
    });
    if (lint) lintParts.push(lint);
    if (type) typeParts.push(type);
    if (test) testParts.push(test);
    if (format) formatParts.push(format);
  }

  const coverage = coverageCheck(coverageCandidates(workdir, allChanged), options.requireTests);
  const { maybeRunRedStateCheck } = await import('./red-state-check');
  const redState = await maybeRunRedStateCheck(
    workdir,
    changedFiles,
    coverage,
    options.preferredBaseBranch,
  );
  // CI-parity checks (prettier, Prisma generated-artifact sync, line-limit
  // ratchet): each hard-fails CI, so catching it here saves a ci_repair round.
  const generatedSync = generatedSyncCheck(allChanged);
  const parity = await ciParityChecks(workdir, allChanged);
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
    ...parity,
    ...hardGateChecks,
    ...(coverage ? [coverage] : []),
    ...(redState ? [redState] : []),
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
    const { runRuntimeVerificationStage } = await import('./runtime-verification-stage');
    const runtime = await runRuntimeVerificationStage(workdir, options.taskId);
    if (runtime) checks.push(runtime);
  }

  const unverifiable = checks.some((c) => c.unverifiable);
  const ok = computeOverallOk(checks);
  const verdict = !ok ? 'fail' : checks.some((c) => c.indeterminate) ? 'unknown' : 'pass';
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

  return { ok, changedFiles, checks, summary: `自動検証: ${summary}`, unverifiable, verdict };
}

// NOTE: Rendering moved to verification-report.ts (file-size split); re-exported
// here so existing importers keep working.
export { renderVerificationMarkdown } from './verification-report';
