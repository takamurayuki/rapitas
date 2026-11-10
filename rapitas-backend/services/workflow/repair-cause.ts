/**
 * repair-cause
 *
 * Classifies one verify→implement repair bounce by WHY it happened, so routing
 * can treat each cause differently (routing2a E): a verified capability gap
 * escalates the next implementer run, an infrastructure failure does not, a
 * requirement defect belongs to replanning, and a finding without grounds is
 * kept apart instead of being counted against the model. Pure; reading the
 * bounce records is repair-escalation.ts's job.
 */
import { isCapabilityAttributableFailure } from './routing-policy';

/**
 * Why a bounce happened.
 * - capability: a verified failure of the work itself (machine gate NG, a
 *   verify verdict, or an evidenced jury finding the verifier did not refute).
 * - infrastructure: the run could not be judged fairly (limits, timeouts,
 *   a broken environment). A stronger model would hit the same wall.
 * - requirements: the requirement or plan is at fault, not the code.
 * - unfounded: a review rejection whose grounds are missing or refuted.
 */
export type RepairCauseKind = 'capability' | 'infrastructure' | 'requirements' | 'unfounded';

/** The subset of a stored jury finding this classifier reads. */
export interface RepairFindingLike {
  gating?: boolean;
  evidence?: string;
  needsCheck?: boolean;
  verification?: string;
}

/** One bounce as recorded: the repair reason and, for a jury bounce, its findings. */
export interface RepairBounceRecord {
  reason: string;
  /** Findings of the adversarial review that caused this bounce; absent when none were stored. */
  findings?: RepairFindingLike[] | null;
}

/**
 * Environment failures that surface INSIDE a gate result (e.g. `test=NG:
 * ECONNREFUSED`) and so slip past routing-policy's limit/timeout pattern.
 */
const ENVIRONMENT_FAILURE_RE =
  /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EADDRINUSE|ENOSPC|no space left on device|worktree が存在しません|worktree (?:is )?missing|playwright install|executable doesn'?t exist|command not found|spawn \S+ ENOENT|database (?:is )?(?:unavailable|unreachable)|can'?t reach database)/i;

/**
 * Wording that blames the requirement or plan rather than the implementation.
 * Kept narrow on purpose: a reason that merely cites an acceptance criterion
 * ("受入基準2のテストが失敗") is a normal capability failure.
 */
const REQUIREMENT_DEFECT_RE =
  /((?:受入基準|要件|仕様|acceptance criteri\w*|requirements?)\s*\d*\s*(?:が|は|の)?[^\n。]{0,20}?(?:矛盾|曖昧|不明確|検証不能|満たせない|contradict\w*|ambiguous|unverifiable)|存在しない前提|計画(?:の|が)(?:誤り|矛盾|不備)|plan\.md\s*の?[^\n。]{0,20}?(?:誤り|矛盾))/i;

/** Prefix the adversarial diff review puts on its repair reason (verify-adversarial-review.ts). */
const JURY_BOUNCE_PREFIX = '差分レビュー不合格';

/**
 * Whether a finding is grounded: gating (blocker/major WITH evidence) and not
 * refuted or left undecided by the verifier seat.
 */
function isGroundedFinding(f: RepairFindingLike): boolean {
  if (!f.gating || f.needsCheck) return false;
  if (typeof f.evidence !== 'string' || f.evidence.trim() === '') return false;
  return f.verification !== 'refuted' && f.verification !== 'undetermined';
}

/**
 * Classify one repair bounce by cause.
 *
 * Order matters: infrastructure first (nothing else can be judged on a run
 * that never got a fair chance), then requirement defects, then the jury's
 * grounds. A jury bounce counts as a capability gap only with at least one
 * grounded finding; without stored findings its grounds cannot be checked,
 * so it is `unfounded` rather than silently escalating.
 *
 * @param record - The bounce reason and any jury findings / 差し戻し理由と陪審の指摘
 * @returns The cause kind / 原因の種別
 */
export function classifyRepairCause(record: RepairBounceRecord): { kind: RepairCauseKind } {
  const reason = (record.reason ?? '').trim();
  if (!reason) return { kind: 'unfounded' };
  if (!isCapabilityAttributableFailure(reason) || ENVIRONMENT_FAILURE_RE.test(reason)) {
    return { kind: 'infrastructure' };
  }
  if (REQUIREMENT_DEFECT_RE.test(reason)) return { kind: 'requirements' };
  if (reason.startsWith(JURY_BOUNCE_PREFIX)) {
    const grounded = (record.findings ?? []).some(isGroundedFinding);
    return { kind: grounded ? 'capability' : 'unfounded' };
  }
  return { kind: 'capability' };
}
