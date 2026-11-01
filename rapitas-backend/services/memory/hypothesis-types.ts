/**
 * HypothesisTypes
 *
 * The ledger's scalar vocabulary: domain, status and evidence stance.
 * Split out so the row mapper, the read side and the write side can each name
 * these without importing one another.
 */
/** Domain a hypothesis is about — bounds the ledger to reasoning-relevant claims. */
export const HYPOTHESIS_DOMAINS = [
  'codebase',
  'agent-behavior',
  'performance',
  'architecture',
  'other',
] as const;
export type HypothesisDomain = (typeof HYPOTHESIS_DOMAINS)[number];
/** Lifecycle: open (untested) → supported / refuted / inconclusive. */
export type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive';
/** Whether a piece of evidence supports or opposes the hypothesis. */
export type EvidenceStance = 'for' | 'against';

import { narrowEnum } from '../../utils/common/type-guards';

/** Coerce an arbitrary value to a valid domain (default 'codebase'). */
export function normalizeDomain(value: unknown): HypothesisDomain {
  return narrowEnum(value, HYPOTHESIS_DOMAINS, 'codebase');
}
