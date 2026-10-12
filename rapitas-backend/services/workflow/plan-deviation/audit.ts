/**
 * plan-deviation/audit
 *
 * Builds the approval-time deviation summary (counts, kinds, ambiguous flag,
 * masked reviewer comment, plan hash) and persists it as an append-only
 * session audit record (`<logs dir>/plan-deviation-audit/<taskId>.ndjson`).
 * Append-only so earlier decisions are never overwritten.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { maskDeviationText } from './deviation-mask';
import { getDeviationDataDir } from './operation-store';
import type { AuditDecision, DeviationAuditRecord, DeviationTimeline } from './types';

/** Max stored comment length (characters, after masking). */
const MAX_COMMENT_LENGTH = 2000;

/** Inputs for one audit record. */
export interface BuildAuditInput {
  taskId: number;
  executionId?: number | null;
  decision: AuditDecision;
  comment?: string | null;
  /** Caller label from X-Rapitas-Source (ui / operator). */
  source: string;
  timeline: DeviationTimeline;
}

/** Directory holding audit files. */
function auditDir(baseDir?: string): string {
  return join(baseDir ?? getDeviationDataDir(), 'plan-deviation-audit');
}

/**
 * Build an audit record from the current timeline. The comment is masked here
 * so no caller can persist it unmasked.
 *
 * @param input - Task, decision, comment and timeline / タスク・判断・コメント・タイムライン
 * @returns Audit record ready to append / 追記用の監査レコード
 */
export function buildAuditRecord(input: BuildAuditInput): DeviationAuditRecord {
  const trimmed = input.comment?.trim();
  let commentMasked: string | null = null;
  if (trimmed) {
    const masked = maskDeviationText(trimmed);
    commentMasked =
      masked.length > MAX_COMMENT_LENGTH ? `${masked.slice(0, MAX_COMMENT_LENGTH)}…` : masked;
  }
  const ambiguous = input.timeline.status === 'ambiguous';
  return {
    taskId: input.taskId,
    executionId: input.executionId ?? null,
    decision: input.decision,
    status: input.timeline.status,
    counts: ambiguous ? null : input.timeline.counts,
    byKind: ambiguous ? null : input.timeline.byKind,
    ambiguous,
    commentMasked,
    planHash: input.timeline.planHash,
    source: input.source,
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Append an audit record to the task's audit file.
 *
 * @param record - Record built by buildAuditRecord / 監査レコード
 * @param baseDir - Data directory override (tests) / 保存先の上書き
 * @throws {Error} When the file cannot be written / 書込み失敗時
 */
export function appendDeviationAudit(record: DeviationAuditRecord, baseDir?: string): void {
  const dir = auditDir(baseDir);
  mkdirSync(dir, { recursive: true });
  appendFileSync(
    join(dir, `${Math.trunc(record.taskId)}.ndjson`),
    `${JSON.stringify(record)}\n`,
    'utf-8',
  );
}

/**
 * List a task's audit records in recording order.
 *
 * @param taskId - Task ID / タスクID
 * @param baseDir - Data directory override (tests) / 保存先の上書き
 * @returns Records (corrupt lines skipped) / 監査レコード一覧
 */
export function listDeviationAudits(taskId: number, baseDir?: string): DeviationAuditRecord[] {
  const file = join(auditDir(baseDir), `${Math.trunc(taskId)}.ndjson`);
  if (!existsSync(file)) return [];
  const out: DeviationAuditRecord[] = [];
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DeviationAuditRecord);
    } catch {
      // A torn final line (crash mid-append) must not hide earlier records.
    }
  }
  return out;
}
