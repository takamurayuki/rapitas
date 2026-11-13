/**
 * milestone-achievement
 *
 * Decides whether a milestone (節目) may be confirmed as reached, and sums a
 * goal's milestones into its reach rate. Pure — the routes load and store.
 *
 * A milestone is reached only when the person has checked every criterion
 * agreed for it and written down why. Task counts are never taken as proof:
 * "all tasks done" can be true while what the milestone meant is not.
 */
import { normalizeCriteria } from '../assistant/criteria-text';

/** Every status a milestone can be stored with. */
export const MILESTONE_STATUSES = ['open', 'reached', 'paused'] as const;

/** One milestone status. `paused` is a legitimate choice, not a failure. */
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** Why a confirmation was refused (HTTP 409 bodies carry this code). */
export type ConfirmationRefusal =
  | 'milestone_criteria_required'
  | 'milestone_criteria_unchecked'
  | 'milestone_criteria_changed'
  | 'milestone_evidence_required'
  | 'milestone_already_reached';

/** What `checkConfirmation` needs to judge a confirmation. */
export interface ConfirmationInput {
  /** The milestone's stored status. */
  status: string;
  /** The criteria agreed for the milestone, as stored now. */
  criteria: string[];
  /** The criteria the person ticked in the confirmation dialog. */
  checkedCriteria: string[];
  /** The person's own account of why the milestone is reached. */
  evidence: string;
}

/**
 * Read a milestone's stored criteria (a JSON array) into a clean list.
 *
 * @param raw - The `acceptanceCriteria` column / 保存された達成条件(JSON)
 * @returns Trimmed, de-duplicated criteria; empty for anything unreadable / 達成条件の一覧
 */
export function parseMilestoneCriteria(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return normalizeCriteria(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Judge whether a milestone may be confirmed as reached.
 *
 * @param input - Stored state plus what the person submitted / 保存状態と送信内容
 * @returns ok with the trimmed evidence, or the refusal code / 可否と理由
 */
export function checkConfirmation(
  input: ConfirmationInput,
): { ok: true; evidence: string } | { ok: false; code: ConfirmationRefusal } {
  if (input.status === 'reached') return { ok: false, code: 'milestone_already_reached' };
  if (input.criteria.length === 0) return { ok: false, code: 'milestone_criteria_required' };

  const agreed = new Set(input.criteria);
  const checked = new Set(normalizeCriteria(input.checkedCriteria));
  // A tick on a criterion that no longer exists means the dialog was opened on
  // an older list; confirming it would confirm something nobody agreed to.
  for (const item of checked) {
    if (!agreed.has(item)) return { ok: false, code: 'milestone_criteria_changed' };
  }
  if (checked.size < agreed.size) return { ok: false, code: 'milestone_criteria_unchecked' };

  const evidence = input.evidence.trim();
  if (!evidence) return { ok: false, code: 'milestone_evidence_required' };
  return { ok: true, evidence };
}

/** A goal's milestone totals. */
export interface GoalProgress {
  total: number;
  reached: number;
  paused: number;
  open: number;
  /** reached ÷ (total − paused); null when nothing is being pursued. */
  reachRate: number | null;
}

/**
 * Sum a goal's milestones into counts and its reach rate (節目到達率).
 *
 * @param milestones - The goal's milestones / ゴールの節目一覧
 * @returns Counts and the reach rate / 件数と到達率
 */
export function goalProgress(milestones: ReadonlyArray<{ status: string }>): GoalProgress {
  let reached = 0;
  let paused = 0;
  for (const m of milestones) {
    if (m.status === 'reached') reached++;
    else if (m.status === 'paused') paused++;
  }
  const total = milestones.length;
  // Paused milestones are left out of the denominator: pausing is a decision
  // the person made, and counting it as a miss would punish making it.
  const pursued = total - paused;
  return {
    total,
    reached,
    paused,
    open: total - reached - paused,
    reachRate: pursued > 0 ? reached / pursued : null,
  };
}
