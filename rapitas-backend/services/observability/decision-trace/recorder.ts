/**
 * decision-trace/recorder
 *
 * Persists one critical decision point (API call / parameter selection /
 * resource access) as an AgentDecisionTrace row: input → considered
 * candidates (top N) → adopted reason → rejected reasons, staged (lite/full)
 * to cap recording cost. Fire-and-forget: never throws, never blocks the
 * execution path it observes (same philosophy as cycle-event-logger.ts).
 *
 * NOTE: Whole-execution best-effort summaries are a DIFFERENT mechanism —
 * see `services/analytics/temporal-debugger.ts`. This module records
 * individual decisions structurally at the moment they happen; the two do
 * not call each other.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { maskSensitive } from './mask';
import type { DecisionCandidate, RecordDecisionInput } from './types';

const log = createLogger('decision-trace');

/** Max candidates persisted per decision (staging strategy — cost cap). */
const MAX_CANDIDATES = 5;

/** Max serialized bytes per JSON field before truncation (record-size cap). */
const MAX_FIELD_CHARS = 2048;

/** Marker appended when a serialized field exceeds MAX_FIELD_CHARS. */
const TRUNCATED_SUFFIX = '…[truncated]';

/**
 * Serializes a masked value to compact JSON, capped at MAX_FIELD_CHARS.
 *
 * @param value - Masked value to serialize / マスク済みの値
 * @param fallback - JSON used when serialization fails / 直列化失敗時の代替JSON
 * @returns Compact JSON string, truncated when oversized / 上限適用済みJSON文字列
 */
function serializeCapped(value: unknown, fallback: string): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? fallback;
  } catch {
    return fallback;
  }
  if (json.length <= MAX_FIELD_CHARS) return json;
  // NOTE: A truncated field is intentionally NOT valid JSON — audit viewers
  // must show it as-is; the cap exists to bound row size, not to stay parseable.
  return json.slice(0, MAX_FIELD_CHARS) + TRUNCATED_SUFFIX;
}

/**
 * Records one critical decision point as an AgentDecisionTrace row.
 *
 * Staging: 0-1 candidates → `lite` (no candidate/rejection payload);
 * 2+ candidates → `full` (top 5 candidates persisted, masked).
 * Callers must NOT await the result on hot paths — invoke as
 * `void recordDecision(...)`; all failures are swallowed and logged.
 *
 * @param input - Raw decision data (masked internally) / 生の意思決定データ（内部でマスク）
 * @returns Resolves when the write settles; never rejects / 書き込み完了で解決、拒否しない
 */
export async function recordDecision(input: RecordDecisionInput): Promise<void> {
  // Same guards as cycle-event-logger: never pollute test DBs, and allow an
  // operator kill-switch without a redeploy. Read at call time so tests can
  // exercise the write path by overriding NODE_ENV.
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.RAPITAS_DECISION_AUDIT === 'off') return;

  try {
    const stage = input.candidates.length >= 2 ? 'full' : 'lite';

    let candidatesMasked = '[]';
    let rejectedReasons = '{}';
    if (stage === 'full') {
      const top = input.candidates.slice(0, MAX_CANDIDATES);
      if (input.candidates.length > MAX_CANDIDATES) {
        log.debug(
          { nodeKey: input.nodeKey, dropped: input.candidates.length - MAX_CANDIDATES },
          'decision candidates trimmed to top N',
        );
      }
      const maskedTop = top.map((c: DecisionCandidate) => ({
        id: c.id,
        label: c.label,
        ...(c.meta ? { meta: maskSensitive(c.meta).masked } : {}),
      }));
      candidatesMasked = serializeCapped(maskedTop, '[]');
      // Only reasons for candidates that were actually persisted.
      const keptIds = new Set(top.map((c) => c.id));
      const rejected: Record<string, string> = {};
      for (const [id, reason] of Object.entries(input.rejectedReasons ?? {})) {
        if (keptIds.has(id)) rejected[id] = maskSensitive(reason).masked as string;
      }
      rejectedReasons = serializeCapped(rejected, '{}');
    }

    const inputMasked = serializeCapped(maskSensitive(input.input ?? {}).masked, '{}');

    await prisma.agentDecisionTrace.create({
      data: {
        taskId: input.taskId ?? null,
        executionId: input.executionId ?? null,
        sessionId: input.sessionId ?? null,
        nodeKey: input.nodeKey,
        parentKeys: serializeCapped(input.parentKeys ?? [], '[]'),
        kind: input.kind,
        summary: maskSensitive(input.summary).masked as string,
        stage,
        inputMasked,
        candidatesMasked,
        adoptedId: input.adoptedId,
        adoptedReason: maskSensitive(input.adoptedReason).masked as string,
        rejectedReasons,
      },
    });
  } catch (err) {
    // Observability must never take down the execution it observes.
    log.warn({ err, nodeKey: input.nodeKey }, 'decision trace write failed (ignored)');
  }
}
