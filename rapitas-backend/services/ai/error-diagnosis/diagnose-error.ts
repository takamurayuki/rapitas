/**
 * diagnose-error
 *
 * LLM-assisted completion of the rule-based provider-error classifier
 * (task 612): when `classifyAgentError` returns null (unclassified), this
 * module masks the error blob, asks the subscription CLI for a root cause /
 * confidence / suggested action, and records the result. Fire-and-forget by
 * design — never blocks or throws into the fallback path that calls it.
 */
import { assessRisk } from '../../observability/pii-risk/risk-assessor';
import { mitigateText } from '../../observability/pii-risk/mitigate';
import { getAuxAiMode, callClaudeCli } from '../../../utils/ai-client';
import { recordDiagnosis } from './error-diagnosis-recorder';
import type { DiagnosisSuggestedAction } from './error-diagnosis.types';
import { createLogger } from '../../../config/logger';

const log = createLogger('ai:error-diagnosis');

const DIAGNOSIS_MODEL = 'claude-haiku-4-5-20251001';
const DIAGNOSIS_MAX_TOKENS = 500;

const SUGGESTED_ACTIONS: readonly DiagnosisSuggestedAction[] = [
  'retry',
  'reroute',
  'manual_intervention',
  'no_action',
];

const SYSTEM_PROMPT = `あなたはプロバイダ通信エラーの原因診断アシスタントです。
以下のJSON形式のみで応答してください。他のテキストは一切含めないこと。
{"rootCause": string, "confidence": number(0-100), "suggestedAction": "retry"|"reroute"|"manual_intervention"|"no_action", "reasoning": string}`;

interface LlmDiagnosisResponse {
  rootCause?: unknown;
  confidence?: unknown;
  suggestedAction?: unknown;
  reasoning?: unknown;
}

/** Clamp a possibly-out-of-range LLM confidence value to an integer 0-100. */
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Fall back to `no_action` when the LLM returns an action outside the enum. */
function normalizeSuggestedAction(value: unknown): DiagnosisSuggestedAction {
  return SUGGESTED_ACTIONS.includes(value as DiagnosisSuggestedAction)
    ? (value as DiagnosisSuggestedAction)
    : 'no_action';
}

export interface DiagnoseErrorInput {
  taskId: number;
  phase: string;
  fromProvider: string;
  fromModel: string | null;
  errorBlob: string;
}

/**
 * Diagnose an unclassified provider error via the subscription CLI and
 * record the result. Never throws — all failures (masking not needed, CLI
 * unavailable, unparseable response) degrade to a no-op.
 *
 * @param input - Facts about the unclassified failure. / 未分類エラーの事実
 */
export async function diagnoseErrorWithLlm(input: DiagnoseErrorInput): Promise<void> {
  if (!input.errorBlob.trim()) return;
  if (getAuxAiMode() === 'off') return;

  const risk = assessRisk(input.errorBlob);
  const maskedBlob = mitigateText(input.errorBlob, risk.level);

  const startedMs = Date.now();
  let res: { content: string };
  try {
    res = await callClaudeCli(
      DIAGNOSIS_MODEL,
      [{ role: 'user', content: maskedBlob }],
      SYSTEM_PROMPT,
      DIAGNOSIS_MAX_TOKENS,
    );
  } catch (err) {
    log.warn({ err }, 'LLM error diagnosis call failed — skipping record');
    return;
  }
  const llmLatencyMs = Date.now() - startedMs;

  let parsed: LlmDiagnosisResponse;
  try {
    parsed = JSON.parse(res.content) as LlmDiagnosisResponse;
  } catch (err) {
    log.warn({ err }, 'LLM error diagnosis response was not valid JSON — skipping record');
    return;
  }
  if (typeof parsed.rootCause !== 'string' || typeof parsed.reasoning !== 'string') {
    log.warn('LLM error diagnosis response missing required fields — skipping record');
    return;
  }

  recordDiagnosis(
    {
      taskId: input.taskId,
      phase: input.phase,
      fromProvider: input.fromProvider,
      fromModel: input.fromModel,
      rootCause: parsed.rootCause,
      confidence: clampConfidence(parsed.confidence),
      suggestedAction: normalizeSuggestedAction(parsed.suggestedAction),
      reasoning: parsed.reasoning,
      llmLatencyMs,
      llmModel: DIAGNOSIS_MODEL,
    },
    Date.now(),
  );
}
