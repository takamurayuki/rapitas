/**
 * KnowledgeReuseComparison
 *
 * Reads the latest knowledge-reuse comparison (produced by the statistical method
 * of task 894) and decides whether it is sufficient evidence. Absent, empty or
 * incomplete comparisons are insufficient; retrieval counts or KB size are never
 * accepted as a substitute.
 * Not responsible for running the statistical comparison itself.
 */
import { appendEvent, queryEvents } from '../memory/timeline';
import {
  ACCEPTANCE_CORRELATION_ID,
  SUPERVISION_SCHEMA_VERSION,
  parseKnowledgeReuseEvalPayload,
  type KnowledgeReuseEvalPayload,
} from './supervision-events';

export interface KnowledgeReuseAssessment {
  sufficientEvidence: boolean;
  latest: KnowledgeReuseEvalPayload | null;
  recordedAt: Date | null;
}

/**
 * Judges one comparison result. Pure.
 *
 * @param latest - Latest parsed evaluation, or null / 最新の評価（無ければnull）
 * @returns Whether it is sufficient evidence / 証拠として十分か
 */
export function assessKnowledgeReuseEvidence(latest: KnowledgeReuseEvalPayload | null): boolean {
  if (!latest) return false;
  return (
    latest.sufficientEvidence &&
    latest.pairedN > 0 &&
    latest.successRateWithKB != null &&
    latest.successRateWithoutKB != null
  );
}

/**
 * Reads the newest comparison event. A newer methodVersion simply supersedes it.
 *
 * @returns Assessment of the newest comparison / 最新比較の評価
 */
export async function readLatestKnowledgeReuseEval(): Promise<KnowledgeReuseAssessment> {
  const { events } = await queryEvents({
    eventType: 'supervision_knowledge_reuse_eval',
    correlationId: ACCEPTANCE_CORRELATION_ID,
    limit: 1,
  });
  const event = events[0];
  const latest = event ? parseKnowledgeReuseEvalPayload(event.payload) : null;
  return {
    sufficientEvidence: assessKnowledgeReuseEvidence(latest),
    latest,
    recordedAt: event ? event.createdAt : null,
  };
}

/**
 * Records a comparison result produced by the approved statistical method.
 *
 * @param input - Comparison figures without schemaVersion / 比較結果
 * @returns The stored payload / 保存したpayload
 * @throws {Error} When the payload does not satisfy the contract / 契約違反の場合
 */
export async function recordKnowledgeReuseEval(
  input: Omit<KnowledgeReuseEvalPayload, 'schemaVersion'>,
): Promise<KnowledgeReuseEvalPayload> {
  const parsed = parseKnowledgeReuseEvalPayload({
    ...input,
    schemaVersion: SUPERVISION_SCHEMA_VERSION,
  });
  if (!parsed) throw new Error('invalid knowledge-reuse evaluation payload');
  await appendEvent({
    eventType: 'supervision_knowledge_reuse_eval',
    actorType: 'system',
    payload: parsed as unknown as Record<string, unknown>,
    correlationId: ACCEPTANCE_CORRELATION_ID,
  });
  return parsed;
}
