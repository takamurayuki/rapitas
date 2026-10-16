/**
 * services/learning barrel
 *
 * Learning-domain services (vocabulary SRS scheduling).
 */
export { computeNextReview } from './vocab-srs';
export type { VocabGrade, VocabSrsState, VocabSrsResult } from './vocab-srs';
export {
  buildRecommendations,
  computeHourBuckets,
  computeRetentionCurve,
  ebbinghausRetention,
  estimateStability,
} from './vocab-analytics';
export type {
  HourBucket,
  RetentionBucket,
  ReviewLogRow,
  StudyRecommendation,
} from './vocab-analytics';
export { migrateStudyGoals } from './study-goal-migration';
export { buildStudyRecommendations, computeStudyPace, localDayKey } from './study-plan-analytics';
export type {
  DailyStudy,
  PaceGoal,
  SessionSlice,
  StudyPace,
  StudySignals,
} from './study-plan-analytics';
export { deleteStudySession, recordStudySession } from './study-time';
export type { RecordStudySessionInput, StudySource } from './study-time';
