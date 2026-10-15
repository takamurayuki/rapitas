/**
 * error-diagnosis-recorder
 *
 * The single write entry point for diagnosis and feedback records. Never
 * throws: diagnosis is a side feature and a recording failure must not
 * propagate into the fallback path it observes.
 */
import { randomUUID } from 'crypto';
import { appendDiagnosis, appendFeedback } from './error-diagnosis-store';
import type {
  DiagnosisFeedbackInput,
  DiagnosisFeedbackRecord,
  DiagnosisRecord,
  DiagnosisRecordInput,
} from './error-diagnosis.types';
import { createLogger } from '../../../config/logger';

const log = createLogger('ai:error-diagnosis');

/**
 * Build a full diagnosis record from the input and append it to the JSONL
 * store.
 *
 * @param input - Diagnosis facts gathered at the LLM call site. / LLM呼び出し地点で得た事実
 * @param nowMs - Record timestamp (injected — this module never calls Date.now()). / 記録時刻
 */
export function recordDiagnosis(input: DiagnosisRecordInput, nowMs: number): void {
  // NOTE: Under bun test (NODE_ENV=test) without an explicit RAPITAS_DATA_DIR,
  // skip recording — existing regression suites drive the REAL fallback path,
  // and their diagnoses would pollute the developer's live store (mirrors
  // recovery-metrics-recorder.ts).
  if (process.env.NODE_ENV === 'test' && !process.env.RAPITAS_DATA_DIR) return;
  try {
    const record: DiagnosisRecord = {
      id: randomUUID(),
      tsMs: nowMs,
      ...input,
    };
    appendDiagnosis(record);
  } catch (err) {
    log.warn({ err }, 'Failed to record error diagnosis (measurement only — execution unaffected)');
  }
}

/**
 * Build a full feedback record from the input and append it to the JSONL
 * store.
 *
 * @param input - Feedback facts from the operator. / 運用者からのフィードバック
 * @param nowMs - Record timestamp (injected). / 記録時刻
 */
export function recordFeedback(input: DiagnosisFeedbackInput, nowMs: number): void {
  const record: DiagnosisFeedbackRecord = {
    id: randomUUID(),
    tsMs: nowMs,
    ...input,
  };
  appendFeedback(record);
}
