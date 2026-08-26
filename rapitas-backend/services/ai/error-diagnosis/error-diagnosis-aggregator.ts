/**
 * error-diagnosis-aggregator
 *
 * Pure aggregation of diagnosis + feedback records into a window summary.
 * No I/O, no clock access — the join is by diagnosisId, in memory only.
 */
import type {
  DiagnosisFeedbackRecord,
  DiagnosisRecord,
  DiagnosisSummary,
} from './error-diagnosis.types';

/**
 * Aggregate diagnosis records and their joined feedback into a summary.
 * All rates default to 0 when there are no diagnoses — never NaN.
 *
 * @param diagnoses - Diagnosis records in the window. / ウィンドウ内の診断レコード
 * @param feedback - All feedback records (joined by diagnosisId). / 全フィードバックレコード
 * @returns Window summary. / ウィンドウ集計
 */
export function aggregate(
  diagnoses: DiagnosisRecord[],
  feedback: DiagnosisFeedbackRecord[],
): DiagnosisSummary {
  const total = diagnoses.length;
  if (total === 0) {
    return { total: 0, avgConfidence: 0, feedbackRate: 0, helpfulRate: 0 };
  }

  const diagnosisIds = new Set(diagnoses.map((d) => d.id));
  const relevantFeedback = feedback.filter((f) => diagnosisIds.has(f.diagnosisId));

  const confidenceSum = diagnoses.reduce((sum, d) => sum + d.confidence, 0);
  const feedbackDiagnosisIds = new Set(relevantFeedback.map((f) => f.diagnosisId));
  const helpfulCount = relevantFeedback.filter((f) => f.helpful).length;

  return {
    total,
    avgConfidence: confidenceSum / total,
    feedbackRate: feedbackDiagnosisIds.size / total,
    helpfulRate: relevantFeedback.length > 0 ? helpfulCount / relevantFeedback.length : 0,
  };
}
