/**
 * Companion services barrel
 *
 * TaskCompanion: which tasks ラピ is seeing through to completion.
 */
export {
  linkCompanionSource,
  startCompanion,
  stopCompanion,
  setCompanionSource,
  type CompanionDb,
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
