/**
 * resume-condition/override
 *
 * The single shared decision "which stop reasons does an approved condition
 * release?" — called by BOTH requeueBlockedTasks and the escalation classifier
 * so the two cannot drift apart (drift = double escalation or lost retry).
 */
import type { BlockedExclusionReason } from '../blocked-task-policy';
import { RESUMABLE_REASONS } from './types';
import type { ConditionState } from './validity';

/**
 * Reasons released by the evaluated condition (empty unless active and allow-listed).
 *
 * @param evaluated - Result of evaluateResumeCondition. / 評価結果
 * @returns Reasons whose exclusion must be skipped. / 解除される理由
 */
export function resolveResumeReleases(evaluated: ConditionState): BlockedExclusionReason[] {
  if (evaluated.state !== 'active') return [];
  const { reason } = evaluated.condition;
  return (RESUMABLE_REASONS as readonly string[]).includes(reason) ? [reason] : [];
}
