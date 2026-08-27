/**
 * error-diagnosis.types
 *
 * Type definitions for the LLM-assisted error diagnosis layer (task 612):
 * one JSONL record per diagnosis attempt (rule-based classification returned
 * `null`), plus the operator feedback record and the aggregate summary shape
 * served by GET /agents/error-diagnosis. Not responsible for diagnosis
 * behavior — types only.
 */

/** Suggested remediation action for a provider-communication diagnosis. */
export type DiagnosisSuggestedAction = 'retry' | 'reroute' | 'manual_intervention' | 'no_action';

/** One JSONL line in `${RAPITAS_DATA_DIR}/error-diagnosis/diagnoses.jsonl`. */
export interface DiagnosisRecord {
  /** Unique id (node:crypto randomUUID) — feedback records join on this. */
  id: string;
  /** Epoch ms at record time (injected by the caller, never Date.now() here). */
  tsMs: number;
  taskId: number;
  /** Workflow role (researcher/planner/…) or `manual` for the executor path. */
  phase: string;
  fromProvider: string;
  fromModel: string | null;
  rootCause: string;
  /** 0-100 integer, clamped and rounded before recording. */
  confidence: number;
  suggestedAction: DiagnosisSuggestedAction;
  reasoning: string;
  llmLatencyMs: number;
  llmModel: string;
}

/** Recorder input — id/tsMs are injected by the recorder. */
export type DiagnosisRecordInput = Omit<DiagnosisRecord, 'id' | 'tsMs'>;

/** One JSONL line in `${RAPITAS_DATA_DIR}/error-diagnosis/feedback.jsonl`. */
export interface DiagnosisFeedbackRecord {
  id: string;
  /** DiagnosisRecord.id this feedback refers to. */
  diagnosisId: string;
  tsMs: number;
  helpful: boolean;
  note: string | null;
}

/** Feedback recorder input — id/tsMs are injected by the recorder. */
export type DiagnosisFeedbackInput = Omit<DiagnosisFeedbackRecord, 'id' | 'tsMs'>;

/** Aggregate summary over a window of diagnoses + their feedback. */
export interface DiagnosisSummary {
  total: number;
  /** Mean confidence across all diagnoses in the window (0 when total is 0). */
  avgConfidence: number;
  /** Fraction of diagnoses that received any feedback (0 when total is 0). */
  feedbackRate: number;
  /** Fraction of feedback marked helpful (0 when no feedback exists). */
  helpfulRate: number;
}
