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
