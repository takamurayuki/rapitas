/**
 * schema-change-gate
 *
 * Deterministic HARD gate that fails verification when a diff touches
 * `prisma/schema/*.prisma` without the plan declaring it. Task 883 showed an
 * implementer changing a Prisma schema inside a worktree in violation of the
 * target repository's AGENTS.md — the existing `scope` check is ADVISORY
 * (task 298 demotion) and does not stop completion on its own. This gate is
 * NOT excluded from computeOverallOk, so an unplanned schema change blocks
 * automated completion regardless of scope's advisory verdict. Not
 * responsible for reading AGENTS.md itself — see workflow-agents-md-context.ts.
 *
 * Task 896: 892 only closed the "unplanned" case. Merely DECLARING the change
 * in plan.md (`isPlanned()===true`) used to make `ok:true` unconditionally —
 * task 883's plan.md declared the `pauseReason` column and still slipped
 * through. `evaluatePlanDeclaredForbiddenChange` now requires an explicit
 * human override (`Task.forbiddenChangeOverride`, set only by the manual
 * approve-plan path — never by auto-approval or the AI's own plan save) for a
 * PLANNED schema change to pass; an unplanned one still fails regardless of
 * override. The gate is scoped to the target repository itself via
 * `isSelfRepoThemeWorkingDirectory` so a Rapitas-specific prohibition is never
 * imposed on an unrelated repository a theme points at.
 */
import { prisma } from '../../../config/database';
import { extractPlanDeclaredFiles } from '../../workflow/plan-declared-files';
import type { VerificationCheck } from './automated-verifier';

/**
 * Matches only source schema files (`prisma/schema/*.prisma`), never the
 * generated `prisma/schema.desktop/` output. Intentionally duplicated from
 * the identical pattern in automated-verifier.ts's `generatedSyncCheck`
 * rather than exported from there, since this file already imports the
 * `VerificationCheck` type FROM automated-verifier.ts — exporting the regex
 * back would create a two-way module dependency. Same pattern as
 * plan-declared-files.ts's PATHISH_RE/DIRISH_RE duplication (see its NOTE).
 */
const PRISMA_SCHEMA_RE = /(^|\/)prisma\/schema\/[^/]+\.prisma$/;

/**
 * Whether a changed protected file is covered by the plan — same part-match
 * semantics as tamperCheck's `planned()` helper (exact / suffix / substring),
 * intentionally kept separate from tamperCheck's own allowlist-augmented plan
 * so a test-path allowance for the tamper threat model never accidentally
 * legitimizes a schema change (see plan.md's design rationale).
 */
function isPlanned(file: string, planFiles: string[]): boolean {
  const f = file.replace(/\\/g, '/').toLowerCase();
  return planFiles.some((p) => {
    const norm = p.replace(/\\/g, '/').toLowerCase();
    return f === norm || f.endsWith(`/${norm}`) || norm.endsWith(`/${f}`) || f.includes(norm);
  });
}

/** Resolved forbidden-change gate context for one task's evaluation. */
export interface ForbiddenChangeGateContext {
  /** False when the theme targets another repository — the gate is skipped. */
  isSelfRepo: boolean;
  /** True only when a human explicitly overrode the forbidden change via approve-plan. */
  overrideGranted: boolean;
}

/** Fail-closed default: self-repo, no override — matches an unresolved/unknown task. */
const DEFAULT_FORBIDDEN_CHANGE_CTX: ForbiddenChangeGateContext = {
  isSelfRepo: true,
  overrideGranted: false,
};

/**
 * Whether a theme's `workingDirectory` points at Rapitas itself (self-repo) —
 * mirrors the existing `themeWorkDir || null` self-repo fallback convention in
 * `workflow-cli-executor-worktree.ts`.
 *
 * @param workingDirectory - Theme's configured working directory, if any. / テーマの作業ディレクトリ
 * @returns True when unset (self-repo), false for an explicit other-repo path. / 自己リポジトリか
 */
export function isSelfRepoThemeWorkingDirectory(
  workingDirectory: string | null | undefined,
): boolean {
  return !workingDirectory || workingDirectory.trim() === '';
}

/**
 * Resolves the forbidden-change gate context for a task from the DB.
 *
 * @param taskId - Task whose plan/theme is being evaluated. / 対象タスクID
 * @returns Self-repo + override state; fail-closed defaults when unresolvable. / ゲート文脈
 */
export async function resolveForbiddenChangeGateContext(
  taskId: number,
): Promise<ForbiddenChangeGateContext> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { forbiddenChangeOverride: true, theme: { select: { workingDirectory: true } } },
    })
    .catch(() => null);
  if (!task) return DEFAULT_FORBIDDEN_CHANGE_CTX;
  return {
    isSelfRepo: isSelfRepoThemeWorkingDirectory(task.theme?.workingDirectory ?? null),
    overrideGranted: !!task.forbiddenChangeOverride,
  };
}

/** Result of evaluating a plan's declared files against the forbidden-change pattern. */
export interface ForbiddenChangeEvaluation {
  ok: boolean;
  matchedFiles: string[];
}

/**
 * Pre-approval check: does plan.md itself DECLARE a forbidden (Prisma schema)
 * change, before any diff exists? Used by the auto-approve and manual-approve
 * gates, which run before implementation starts and so have no changed-files
 * diff to compare — only the plan's own declared-files section.
 *
 * @param planContent - plan.md text, or null/undefined. / plan.md 本文
 * @param ctx - Resolved self-repo + override state. / ゲート文脈
 * @returns ok:false with the matched paths when a plan-declared change is forbidden. / 判定
 */
export function evaluatePlanDeclaredForbiddenChange(
  planContent: string | null | undefined,
  ctx: ForbiddenChangeGateContext,
): ForbiddenChangeEvaluation {
  if (!ctx.isSelfRepo) return { ok: true, matchedFiles: [] };
  const matchedFiles = extractPlanDeclaredFiles(planContent).filter((f) =>
    PRISMA_SCHEMA_RE.test(f.replace(/\\/g, '/')),
  );
  if (matchedFiles.length === 0) return { ok: true, matchedFiles: [] };
  return { ok: ctx.overrideGranted, matchedFiles };
}

/**
 * Evaluates the schema-change hard gate.
 *
 * @param allChangedFiles - Every changed path in the worktree diff. / 全変更ファイル
 * @param planFiles - Paths parsed from plan.md, or null in plan-less mode. / 計画対象パス（軽量モードはnull）
 * @param ctx - Self-repo + override state; defaults fail-closed. / ゲート文脈（既定はfail-closed）
 * @returns A 'schema-change' check, or null when no schema file changed. / 判定 or null
 */
export function schemaChangeGateCheck(
  allChangedFiles: string[],
  planFiles: string[] | null,
  ctx: ForbiddenChangeGateContext = DEFAULT_FORBIDDEN_CHANGE_CTX,
): VerificationCheck | null {
  const norm = allChangedFiles.map((f) => f.replace(/\\/g, '/'));
  const schemaChanged = allChangedFiles.filter((f, i) => PRISMA_SCHEMA_RE.test(norm[i]!));
  if (schemaChanged.length === 0) return null;

  if (!ctx.isSelfRepo) {
    return {
      name: 'schema-change',
      ran: true,
      ok: true,
      errorCount: 0,
      details: `schema-change: 対象リポジトリはRapitas自身ではないため本ゲートをスキップしました（${schemaChanged.length} 件のスキーマ変更）`,
    };
  }

  const plan = planFiles ?? [];
  const unplanned = schemaChanged.filter((f) => !isPlanned(f, plan));
  if (unplanned.length > 0) {
    return {
      name: 'schema-change',
      ran: true,
      ok: false,
      errorCount: unplanned.length,
      details:
        `plan.md に明記のない Prisma スキーマ変更を検出しました。worktree 内でのスキーマ変更は ` +
        `AGENTS.md で禁止されている場合があります。正当な変更であれば plan.md の変更予定ファイルに` +
        `このファイルを明記し、承認を得てから再実行してください:\n${unplanned.slice(0, 20).join('\n')}`,
    };
  }

  const ok = ctx.overrideGranted;
  return {
    name: 'schema-change',
    ran: true,
    ok,
    errorCount: ok ? 0 : schemaChanged.length,
    details: ok
      ? `schema-change: ${schemaChanged.length} 件の Prisma スキーマ変更は plan.md に明記済みで、明示ユーザー上書きにより許可されました`
      : `schema-change: ${schemaChanged.length} 件の Prisma スキーマ変更は plan.md に明記されていますが、` +
        `明示ユーザー上書きがないため許可されません。承認時に禁止変更の上書きを明示してから再実行してください:\n${schemaChanged.slice(0, 20).join('\n')}`,
  };
}

/**
 * Combines the scope / tamper / schema-change HARD gates into one checks
 * array. Factored out of automated-verifier.ts (rather than inlined there)
 * to keep that already-oversized file from growing past its file-size
 * ratchet baseline.
 *
 * @param scopeCheck - Scope-deviation check, or null in plan-less mode. / スコープ判定 or null
 * @param tamper - Anti-tampering check. / 改ざん判定
 * @param schemaGate - This module's schema-change check, or null. / スキーマ変更判定 or null
 * @returns The non-null checks, in gate-evaluation order. / 非nullの判定一覧
 */
export function collectHardGateChecks(
  scopeCheck: VerificationCheck | null,
  tamper: VerificationCheck | null,
  schemaGate: VerificationCheck | null,
): VerificationCheck[] {
  return [
    ...(scopeCheck ? [scopeCheck] : []),
    ...(tamper ? [tamper] : []),
    ...(schemaGate ? [schemaGate] : []),
  ];
}
