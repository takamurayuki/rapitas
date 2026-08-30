/**
 * SelfDetectRelevance
 *
 * Decides whether a [自己検出] alarm concern still describes the CURRENT
 * state, so the backlog promoter can retire a stale one instead of spending
 * agent phases to conclude 修正不要. Responsible only for the relevance
 * question; filing, promotion and resolution stay with their own modules.
 *
 * Measured 2026-08-30: 25 of the week's 31 no-change completions were [Bug]
 * filings, mostly 自己検出 alarms (状態不整合 / 反復ループ) whose condition
 * had already healed by the time the task ran. [回顧] diagnostics are NOT
 * covered here on purpose — #768 proved they produce real improvement work.
 */
import { createLogger } from '../../../config/logger';

const log = createLogger('auto-run:self-detect-relevance');

/** Parsed identity of a self-detect alarm title. */
export interface SelfDetectSignature {
  kind: 'state_mismatch' | 'repeat_loop';
  /** Task the alarm is anchored to, when the title names one. */
  anchorTaskId: number | null;
  /** The repeating transition cause (repeat_loop only). */
  cause: string | null;
}

/**
 * Parse a [自己検出] alarm title into its checkable signature.
 *
 * Formats (see incident-signature-detectors):
 * - `[自己検出] 状態不整合: #572「…」— task.status=todo のまま …`
 * - `[自己検出] 反復ループ: #603「…」で cause=verify_repair が3回`
 *
 * @param title - Concern title. / 懸念タイトル
 * @returns Signature, or null when not a self-detect alarm. / 該当しなければ null
 */
export function parseSelfDetectSignature(
  title: string | null | undefined,
): SelfDetectSignature | null {
  if (!title || !title.includes('[自己検出]')) return null;
  const kind = title.includes('状態不整合')
    ? ('state_mismatch' as const)
    : title.includes('反復ループ')
      ? ('repeat_loop' as const)
      : null;
  if (!kind) return null;
  const anchor = title.match(/[:：]\s*#(\d+)/);
  const cause = title.match(/cause=([A-Za-z0-9_:.-]+)/);
  return {
    kind,
    anchorTaskId: anchor ? Number(anchor[1]) : null,
    cause: cause ? cause[1] : null,
  };
}

/** Injectable lookups for tests. */
export interface RelevanceDeps {
  getTaskState: (
    taskId: number,
  ) => Promise<{ status: string; workflowStatus: string | null } | null>;
  countCauseSince: (taskId: number, cause: string, sinceMs: number) => Promise<number>;
}

// Lazy prisma: keeps this module out of the promoter's static import graph
// (its tests partial-mock config/database and a static import breaks them).
const defaultDeps: RelevanceDeps = {
  getTaskState: async (taskId) => {
    const { prisma } = await import('../../../config');
    return prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, workflowStatus: true },
    });
  },
  countCauseSince: async (taskId, cause, sinceMs) => {
    const { prisma } = await import('../../../config');
    return prisma.workflowTransition.count({
      where: { taskId, cause, createdAt: { gt: new Date(sinceMs) } },
    });
  },
};

/** workflowStatus values the 状態不整合 alarm considers "advanced past todo". */
const ADVANCED_WF = new Set([
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
]);

/**
 * Whether a [自己検出] alarm still holds against the live state.
 *
 * Fails OPEN: an unparseable title, a missing anchor, or a lookup error
 * returns null and the caller promotes as it always has. Only a definite
 * "the alarmed condition is gone" retires a concern.
 *
 * - state_mismatch: stale unless the anchor task is STILL status=todo with an
 *   advanced workflowStatus.
 * - repeat_loop: stale when the cause has not fired again on the anchor task
 *   since the concern was filed.
 *
 * @param concern - Title and filing time. / 懸念（タイトルと起票時刻）
 * @param deps - Test overrides. / テスト用差し替え
 * @returns true = still true, false = stale, null = unknown. / 継続 / 陳腐化 / 不明
 */
export async function isSelfDetectConcernStillRelevant(
  concern: {
    title: string | null | undefined;
    createdAt: Date | string | number | null | undefined;
  },
  deps: Partial<RelevanceDeps> = {},
): Promise<boolean | null> {
  const sig = parseSelfDetectSignature(concern.title);
  if (!sig || sig.anchorTaskId == null) return null;
  const d: RelevanceDeps = { ...defaultDeps, ...deps };
  try {
    if (sig.kind === 'state_mismatch') {
      const t = await d.getTaskState(sig.anchorTaskId);
      if (!t) return false; // the alarmed task no longer exists — nothing to fix
      return t.status === 'todo' && !!t.workflowStatus && ADVANCED_WF.has(t.workflowStatus);
    }
    // repeat_loop
    if (!sig.cause) return null;
    const created = concern.createdAt ? new Date(concern.createdAt).getTime() : NaN;
    if (!Number.isFinite(created)) return null;
    const n = await d.countCauseSince(sig.anchorTaskId, sig.cause, created);
    return n > 0;
  } catch (err) {
    log.warn(
      { err, title: String(concern.title).slice(0, 80) },
      '[self-detect] relevance check failed — promoting as usual',
    );
    return null;
  }
}
