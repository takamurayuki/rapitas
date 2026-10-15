/**
 * schema-change-gate
 *
 * Deterministic HARD gate that fails verification when a diff touches
 * `prisma/schema/*.prisma` without the plan declaring it AND without an
 * explicit human override. Task 883 showed an implementer changing a Prisma
 * schema inside a worktree in violation of the target repository's
 * AGENTS.md — the existing `scope` check is ADVISORY (task 298 demotion)
 * and does not stop completion on its own. This gate is NOT excluded from
 * computeOverallOk, so an unplanned schema change blocks automated
 * completion regardless of scope's advisory verdict. Task 892 only closed
 * the "plan declares it" half — task 1059 adds the override half: a plan
 * declaring the schema change is necessary but not sufficient; only
 * `Task.forbiddenChangeOverride` (set exclusively by the human `approve-plan`
 * path — see workflow-handlers-plan.ts) makes a declared schema change `ok`.
 * Not responsible for reading AGENTS.md itself — see
 * workflow-agents-md-context.ts.
 */
import type { VerificationCheck } from './automated-verifier';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('verification:schema-change-gate');

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
 * Whether a path is a source Prisma schema file. Exported so plan-time
 * callers (plan-post-processing.ts) can reuse the exact same criterion the
 * verify-time gate uses, instead of re-deriving a second regex.
 *
 * @param file - A path (any separator style). / 判定対象パス
 * @returns Whether it is a `prisma/schema/*.prisma` source file. / 判定結果
 */
export function isSchemaFilePath(file: string): boolean {
  return PRISMA_SCHEMA_RE.test(file.replace(/\\/g, '/'));
}

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

/**
 * Evaluates the schema-change hard gate. A schema change is `ok` only when
 * every changed schema file is both planned AND `forbiddenChangeOverride` is
 * true — plan.md declaring the file is necessary but never sufficient on its
 * own (task 1059; see the module header).
 *
 * @param allChangedFiles - Every changed path in the worktree diff. / 全変更ファイル
 * @param planFiles - Paths parsed from plan.md, or null in plan-less mode. / 計画対象パス（軽量モードはnull）
 * @param forbiddenChangeOverride - Whether a human explicitly approved this
 *   forbidden change via `approve-plan` (default false = not approved). / 人間による明示承認の有無
 * @returns A 'schema-change' check, or null when no schema file changed. / 判定 or null
 */
export function schemaChangeGateCheck(
  allChangedFiles: string[],
  planFiles: string[] | null,
  forbiddenChangeOverride = false,
): VerificationCheck | null {
  const schemaChanged = allChangedFiles.filter((f) => isSchemaFilePath(f));
  if (schemaChanged.length === 0) return null;

  const plan = planFiles ?? [];
  const unplanned = schemaChanged.filter((f) => !isPlanned(f, plan));
  const ok = unplanned.length === 0 && forbiddenChangeOverride;
  const errorCount =
    unplanned.length > 0 ? unplanned.length : forbiddenChangeOverride ? 0 : schemaChanged.length;
  return {
    name: 'schema-change',
    ran: true,
    ok,
    errorCount,
    details: ok
      ? `schema-change: ${schemaChanged.length} 件の Prisma スキーマ変更はすべて plan.md に明記済みかつ人間による明示承認(forbiddenChangeOverride)あり`
      : unplanned.length > 0
        ? `plan.md に明記のない Prisma スキーマ変更を検出しました。worktree 内でのスキーマ変更は ` +
          `AGENTS.md で禁止されている場合があります。正当な変更であれば plan.md の変更予定ファイルに` +
          `このファイルを明記し、承認を得てから再実行してください:\n${unplanned.slice(0, 20).join('\n')}`
        : `plan.md に明記された Prisma スキーマ変更ですが、人間による明示承認(forbiddenChangeOverride)がありません。` +
          `approve-plan API に overrideForbiddenChange:true と overrideReason を指定して承認を得てください:\n${schemaChanged.slice(0, 20).join('\n')}`,
  };
}

/**
 * Reads whether a human explicitly approved this task's declared forbidden
 * change. Fails closed (`false`) on any DB error — a read failure must never
 * be treated as an approval (task 1059 AC4).
 *
 * @param taskId - The task whose override flag to read. / 対象タスクID
 * @returns Whether the override is set, or false on missing taskId/DB error. / 承認有無（失敗時false）
 */
export async function resolveForbiddenChangeOverride(taskId: number | undefined): Promise<boolean> {
  if (taskId === undefined) return false;
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { forbiddenChangeOverride: true },
    });
    return task?.forbiddenChangeOverride === true;
  } catch (err) {
    log.warn(
      { taskId, err },
      'forbiddenChangeOverride の読み取りに失敗したため false(未承認) として扱います',
    );
    return false;
  }
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
