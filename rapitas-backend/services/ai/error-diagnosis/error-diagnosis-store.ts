/**
 * error-diagnosis-store
 *
 * JSONL persistence for LLM error-diagnosis records and their operator
 * feedback. Lives in RAPITAS_DATA_DIR (default ~/.rapitas), separate from
 * recovery-metrics/attempts.jsonl to keep the two schemas independent. Pure
 * I/O: no aggregation, no policy.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import type { DiagnosisFeedbackRecord, DiagnosisRecord } from './error-diagnosis.types';

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

/** Absolute path of the diagnoses JSONL (resolved per call so tests can redirect via env). */
export function diagnosesFilePath(): string {
  return join(dataDir(), 'error-diagnosis', 'diagnoses.jsonl');
}

/** Absolute path of the feedback JSONL (resolved per call so tests can redirect via env). */
export function feedbackFilePath(): string {
  return join(dataDir(), 'error-diagnosis', 'feedback.jsonl');
}

/** Minimal shape check so a hand-edited/corrupt line degrades to a skip. */
function isDiagnosisRecord(value: unknown): value is DiagnosisRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<DiagnosisRecord>;
  return (
    typeof v.id === 'string' &&
    typeof v.tsMs === 'number' &&
    typeof v.rootCause === 'string' &&
    typeof v.confidence === 'number' &&
    typeof v.suggestedAction === 'string'
  );
}

/** Minimal shape check so a hand-edited/corrupt line degrades to a skip. */
function isFeedbackRecord(value: unknown): value is DiagnosisFeedbackRecord {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Partial<DiagnosisFeedbackRecord>;
  return (
    typeof v.id === 'string' &&
    typeof v.diagnosisId === 'string' &&
    typeof v.tsMs === 'number' &&
    typeof v.helpful === 'boolean'
  );
}

/**
 * Append one diagnosis record as a JSONL line, creating the directory on
 * first use. I/O failures propagate — the recorder above is the never-throw
 * layer.
 *
 * @param record - Diagnosis record to persist. / 保存する診断レコード
 */
export function appendDiagnosis(record: DiagnosisRecord): void {
  const file = diagnosesFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Read diagnosis records, skipping malformed lines (best-effort; empty array
 * on any read failure — a corrupt store must never 500 the diagnosis API).
 *
 * @param sinceMs - Only return records with tsMs >= sinceMs when given. / この時刻以降のみ返す
 * @returns Parsed records in file order. / ファイル順のレコード
 */
export function readDiagnoses(sinceMs?: number): DiagnosisRecord[] {
  try {
    const lines = readFileSync(diagnosesFilePath(), 'utf8').split('\n');
    const records: DiagnosisRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isDiagnosisRecord(parsed)) continue;
        if (sinceMs !== undefined && parsed.tsMs < sinceMs) continue;
        records.push(parsed);
      } catch {
        continue;
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Append one feedback record as a JSONL line, creating the directory on
 * first use.
 *
 * @param record - Feedback record to persist. / 保存するフィードバックレコード
 */
export function appendFeedback(record: DiagnosisFeedbackRecord): void {
  const file = feedbackFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

/**
 * Read all feedback records, skipping malformed lines (best-effort; empty
 * array on any read failure).
 *
 * @returns Parsed records in file order. / ファイル順のレコード
 */
export function readFeedback(): DiagnosisFeedbackRecord[] {
  try {
    const lines = readFileSync(feedbackFilePath(), 'utf8').split('\n');
    const records: DiagnosisFeedbackRecord[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isFeedbackRecord(parsed)) continue;
        records.push(parsed);
      } catch {
        continue;
      }
    }
    return records;
  } catch {
    return [];
  }
}
