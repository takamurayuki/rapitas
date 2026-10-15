/**
 * plan-deviation/timeline-builder
 *
 * Assembles the deviation timeline returned to the UI from plan.md, the
 * recorded operations and the execution state. Decides the overall status
 * (unsupported provider → ambiguous plan → no operations → ok). Pure — the
 * caller loads the inputs.
 */
import { classifyOperations } from './classifier';
import { hashDeclaration, parsePlanDeclaration } from './declaration-parser';
import type { DeviationTimeline, OperationRecord } from './types';

/** Warning shown when the plan declares no file patterns (受入基準6). */
export const AMBIGUOUS_PLAN_WARNING =
  'Plan is ambiguous: no file path pattern is declared, so it is not used for deviation judging';

/** Inputs for one timeline build. */
export interface BuildTimelineInput {
  planContent: string | null | undefined;
  operations: OperationRecord[];
  operationWarnings?: string[];
  executionTerminal: boolean;
  workDir?: string | null;
  /** AIAgentConfig.agentType of the execution, when known. */
  agentType?: string | null;
}

/**
 * Whether operation recording exists for the execution's provider. Only the
 * Claude stream-json path records tool_use inputs; Codex/Gemini formats are
 * unverified, so they are reported as unsupported instead of misjudged.
 *
 * @param agentType - AIAgentConfig.agentType (null = default Claude agent) / エージェント種別
 * @returns True when the provider is judged / 判定対象なら true
 */
export function isSupportedProvider(agentType: string | null | undefined): boolean {
  if (!agentType) return true;
  return agentType.toLowerCase().includes('claude');
}

/**
 * Build the deviation timeline.
 *
 * @param input - Plan text, operations and execution state / 計画・操作・実行状態
 * @returns Timeline with status, chronological entries and counts / タイムライン
 */
export function buildDeviationTimeline(input: BuildTimelineInput): DeviationTimeline {
  const parsed = parsePlanDeclaration(input.planContent);
  const warnings = [...parsed.warnings, ...(input.operationWarnings ?? [])];
  const planHash = parsed.ambiguous ? null : hashDeclaration(parsed.declaration);
  const empty = { entries: [], counts: null, byKind: null };

  if (!isSupportedProvider(input.agentType)) {
    return { status: 'unsupported_provider', ...empty, warnings, planHash };
  }
  if (parsed.ambiguous) {
    return {
      status: 'ambiguous',
      ...empty,
      warnings: [AMBIGUOUS_PLAN_WARNING, ...warnings],
      planHash,
    };
  }
  if (input.operations.length === 0) {
    return { status: 'no_operations', ...empty, warnings, planHash };
  }
  const result = classifyOperations(
    parsed,
    input.operations,
    input.executionTerminal,
    input.workDir,
  );
  return { ...result, warnings, planHash };
}
