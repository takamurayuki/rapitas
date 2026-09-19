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
 * Task 896: "planned" alone used to be sufficient — a plan.md that merely
 * DECLARED a schema change (883's `pauseReason` column) was treated as
 * implicit permission, even though neither auto-approval nor manual approval
 * had ever inspected the plan body. `ctx.overrideGranted` now gates the
 * planned-but-schema-changed case; only an explicit user override
 * (Task.forbiddenChangeOverride, set solely by a manual approve-plan call —
 * never by auto-approval or the AI's own plan save) can pass it.
 */
import type { VerificationCheck } from './automated-verifier';
import { prisma } from '../../../config/database';
import { extractPlanDeclaredFiles } from '../../workflow/plan-declared-files';

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

/** Context resolved per-task, consumed by both the gate and its callers (task 896). */
export interface ForbiddenChangeGateContext {
  /** False when the task's Theme.workingDirectory points at a non-Rapitas repo — the gate then no-ops. */
  isSelfRepo?: boolean;
  /** True only when a manual approve-plan call set Task.forbiddenChangeOverride — never set by auto-approval. */
  overrideGranted?: boolean;
}

const DEFAULT_GATE_CONTEXT: Required<ForbiddenChangeGateContext> = {
  isSelfRepo: true,
  overrideGranted: false,
};

/**
 * `Theme.workingDirectory` unset/empty means the task runs against Rapitas'
 * own git root — the same fallback convention `workflow-cli-executor-worktree.ts`
 * already uses. A non-empty value means a different target repository, where
 * Rapitas-specific forbidden-path patterns (e.g. its own Prisma schema rule)
 * must not apply.
 *
 * @param workingDirectory - Theme.workingDirectory value, or null/undefined. / テーマの作業ディレクトリ
 * @returns True when the task targets Rapitas' own repository. / 自リポジトリなら true
 */
export function isSelfRepoThemeWorkingDirectory(
  workingDirectory: string | null | undefined,
): boolean {
  return !workingDirectory || workingDirectory.trim() === '';
}

/**
 * Resolves the forbidden-change gate context for a task: which repository it
 * targets, and whether a human has explicitly overridden the gate. Fails
 * closed (self-repo, no override) whenever the task can't be resolved, so an
 * unresolvable context never accidentally permits a forbidden change.
 *
 * @param taskId - Task to resolve context for. / 対象タスクID
 * @returns Gate context, defaulting to fail-closed on any lookup failure. / ゲート文脈
 */
export async function resolveForbiddenChangeGateContext(
  taskId: number,
): Promise<Required<ForbiddenChangeGateContext>> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { forbiddenChangeOverride: true, theme: { select: { workingDirectory: true } } },
    })
    .catch(() => null);
  if (!task) return { ...DEFAULT_GATE_CONTEXT };
  return {
    isSelfRepo: isSelfRepoThemeWorkingDirectory(task.theme?.workingDirectory ?? null),
    overrideGranted: !!task.forbiddenChangeOverride,
  };
}

/**
 * Checks whether plan.md's DECLARED file list itself contains a forbidden
 * schema path, independent of what the actual diff contains — used by the
 * pre-implementation gates (auto-approve, manual approve-plan) where no diff
 * exists yet. Declaring a forbidden path is not itself sufficient
 * permission: `ctx.overrideGranted` must also be true, or a plan that
 * merely reproduces 883 (declares `pauseReason` in `plan.md`) would sail
 * through both approval gates exactly as it did before task 896.
 *
 * @param planContent - Raw plan.md body, or null/undefined. / plan本文
 * @param ctx - Resolved repo/override context. / ゲート文脈
 * @returns ok + the matched forbidden paths, if any. / 判定結果と該当パス
 */
export function evaluatePlanDeclaredForbiddenChange(
  planContent: string | null | undefined,
  ctx: ForbiddenChangeGateContext = {},
): { ok: boolean; matchedFiles: string[] } {
  const merged = { ...DEFAULT_GATE_CONTEXT, ...ctx };
  if (!merged.isSelfRepo) return { ok: true, matchedFiles: [] };
  const declared = extractPlanDeclaredFiles(planContent ?? '');
  const matchedFiles = declared.filter((f) => PRISMA_SCHEMA_RE.test(f.replace(/\\/g, '/')));
  if (matchedFiles.length === 0) return { ok: true, matchedFiles: [] };
  return { ok: merged.overrideGranted, matchedFiles };
}

/**
 * Evaluates the schema-change hard gate.
 *
 * @param allChangedFiles - Every changed path in the worktree diff. / 全変更ファイル
 * @param planFiles - Paths parsed from plan.md, or null in plan-less mode. / 計画対象パス（軽量モードはnull）
 * @param ctx - Repo/override context (task 896); defaults fail-closed. / ゲート文脈（省略時はfail-closed）
 * @returns A 'schema-change' check, or null when no schema file changed. / 判定 or null
 */
export function schemaChangeGateCheck(
  allChangedFiles: string[],
  planFiles: string[] | null,
  ctx: ForbiddenChangeGateContext = {},
): VerificationCheck | null {
  const norm = allChangedFiles.map((f) => f.replace(/\\/g, '/'));
  const schemaChanged = allChangedFiles.filter((f, i) => PRISMA_SCHEMA_RE.test(norm[i]!));
  if (schemaChanged.length === 0) return null;

  const merged = { ...DEFAULT_GATE_CONTEXT, ...ctx };
  if (!merged.isSelfRepo) {
    return {
      name: 'schema-change',
      ran: true,
      ok: true,
      errorCount: 0,
      details: `schema-change: 対象リポジトリが Rapitas 自身ではないためスキップ (${schemaChanged.length} 件)`,
    };
  }

  const plan = planFiles ?? [];
  const unplanned = schemaChanged.filter((f) => !isPlanned(f, plan));
  if (unplanned.length > 0) {
    // Undisclosed changes are always NG regardless of override — override
    // only rescues a DECLARED-but-forbidden change, never an undisclosed one.
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

  // All declared, but declaration alone is no longer sufficient (task 896) —
  // require an explicit user override (883 regression: plan-declared
  // pauseReason column must not auto-pass this gate).
  const ok = merged.overrideGranted;
  return {
    name: 'schema-change',
    ran: true,
    ok,
    errorCount: ok ? 0 : schemaChanged.length,
    details: ok
      ? `schema-change: ${schemaChanged.length} 件の Prisma スキーマ変更は plan.md に明記済みかつ明示ユーザー上書き承認済み`
      : `schema-change: ${schemaChanged.length} 件の Prisma スキーマ変更は plan.md に明記されていますが、` +
        `明示ユーザー上書き（forbiddenChangeOverride）がありません。計画記載だけでは許可されません。` +
        `human が approve-plan に overrideForbiddenChange+overrideReason を付けて承認してください:\n${schemaChanged.slice(0, 20).join('\n')}`,
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
