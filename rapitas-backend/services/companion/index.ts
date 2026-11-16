/**
 * Companion services barrel
 *
 * TaskCompanion: which tasks ラピ is seeing through to completion, and the
 * digest of what changed on them since the user last looked.
 */
export {
  linkCompanionSource,
  startCompanion,
  stopCompanion,
  setCompanionSource,
  readCompanionState,
  closeCompanionsForDeletion,
  type CompanionDb,
  type CompanionDeletionDb,
  type CompanionState,
  type CompanionTaskRow,
  type CompanionOrigin,
  type CompanionClosedReason,
  type CompanionRow,
  type StartCompanionResult,
  type StopCompanionResult,
} from './companion-service';

export {
  planCompanionBackfill,
  backfillCompanions,
  type BackfillActionRow,
  type BackfillDb,
  type BackfillPlan,
  type PlannedCompanion,
} from './companion-backfill';

export {
  detectCompanionRequest,
  COMPANION_KEYWORD,
  type CompanionRequest,
} from './companion-intent';

export {
  buildCompanionDigest,
  classifyTransition,
  decisionFor,
  MAX_DIGEST_EVENTS,
  type CompanionDigest,
  type DigestItem,
  type DigestDecision,
  type DigestDecisionKind,
  type DigestEvent,
  type DigestEventKind,
} from './companion-digest';

export {
  readCompanionDigest,
  markDigestSeen,
  MAX_DIGEST_TRANSITIONS,
  type DigestDb,
  type DigestDeps,
  type DigestSeenCursor,
} from './companion-digest-reader';
