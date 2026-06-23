/**
 * agent-execution-types.guards.generated
 *
 * 自動生成ファイル — 手動編集不可。再生成: `bun run gen:type-guards`
 * ソース: scripts/gen-type-guards.ts
 *
 * 命名規約:
 *   is*     — 型ガード: unknown 値が対象型かを boolean で返す
 *   narrow* — narrowing: DB 等からの raw string を対象型へ変換し、不正値を fallback で返す
 */

import type { AgentExecutionStatus, QuestionType, LogType, RealtimeEventType } from './agent-execution-types';
import { AGENT_EXECUTION_STATUSES, QUESTION_TYPES, LOG_TYPES, REALTIME_EVENT_TYPES } from './agent-execution-types';

/**
 * Type guard: narrows an unknown value to AgentExecutionStatus.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid AgentExecutionStatus. / 有効なAgentExecutionStatusの場合true
 */
export function isAgentExecutionStatus(s: unknown): s is AgentExecutionStatus {
  return typeof s === 'string' && (AGENT_EXECUTION_STATUSES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to AgentExecutionStatus, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'pending'`. / 無効時に返す値
 * @returns A valid AgentExecutionStatus. / 有効なAgentExecutionStatus
 */
export function narrowAgentExecutionStatus(
  s: string | null | undefined,
  fallback: AgentExecutionStatus = 'pending',
): AgentExecutionStatus {
  return isAgentExecutionStatus(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to QuestionType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid QuestionType. / 有効なQuestionTypeの場合true
 */
export function isQuestionType(s: unknown): s is QuestionType {
  return typeof s === 'string' && (QUESTION_TYPES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to QuestionType, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'tool_call'`. / 無効時に返す値
 * @returns A valid QuestionType. / 有効なQuestionType
 */
export function narrowQuestionType(
  s: string | null | undefined,
  fallback: QuestionType = 'tool_call',
): QuestionType {
  return isQuestionType(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to LogType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid LogType. / 有効なLogTypeの場合true
 */
export function isLogType(s: unknown): s is LogType {
  return typeof s === 'string' && (LOG_TYPES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to LogType, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'info'`. / 無効時に返す値
 * @returns A valid LogType. / 有効なLogType
 */
export function narrowLogType(
  s: string | null | undefined,
  fallback: LogType = 'info',
): LogType {
  return isLogType(s) ? s : fallback;
}

/**
 * Type guard: narrows an unknown value to RealtimeEventType.
 *
 * @param s - Value to test. / 検査する値
 * @returns True when `s` is a valid RealtimeEventType. / 有効なRealtimeEventTypeの場合true
 */
export function isRealtimeEventType(s: unknown): s is RealtimeEventType {
  return typeof s === 'string' && (REALTIME_EVENT_TYPES as readonly string[]).includes(s);
}

/**
 * Narrows a DB string (or null/undefined) to RealtimeEventType, returning a fallback
 * when the value is absent or unrecognised.
 *
 * @param s - Raw value from the database. / DBからの生の値
 * @param fallback - Value to return when `s` is invalid. Defaults to `'agent_execution_started'`. / 無効時に返す値
 * @returns A valid RealtimeEventType. / 有効なRealtimeEventType
 */
export function narrowRealtimeEventType(
  s: string | null | undefined,
  fallback: RealtimeEventType = 'agent_execution_started',
): RealtimeEventType {
  return isRealtimeEventType(s) ? s : fallback;
}
