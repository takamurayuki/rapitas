/**
 * ParallelExecution — ExecutorTypes
 *
 * Internal type definitions for the ParallelExecutor: events, event listeners,
 * default config, and the coordinator payload formatter.
 * Not responsible for any runtime logic.
 */

import type { ParallelExecutionConfig } from './types';

/**
 * Event emitted by ParallelExecutor for session and task lifecycle changes.
 */
export type ParallelExecutionEvent = {
  type:
    | 'session_started'
    | 'session_completed'
    | 'session_failed'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'level_started'
    | 'level_completed'
    | 'progress_updated'
    | 'conflict_detected'
    | 'safety_report_ready';
  sessionId: string;
  taskId?: number;
  level?: number;
  data?: unknown;
  timestamp: Date;
};

export type ParallelExecutionEventListener = (event: ParallelExecutionEvent) => void;

/**
 * Default configuration for parallel execution sessions.
 */
export const DEFAULT_CONFIG: ParallelExecutionConfig = {
  maxConcurrentAgents: 3,
  questionTimeoutSeconds: 300,
  taskTimeoutSeconds: 300,
  retryOnFailure: true,
  maxRetries: 2,
  logSharing: true,
  coordinationEnabled: true,
};

/**
 * Format a coordinator message payload into a concise log string.
 *
 * @param payload - Raw payload from coordinator message / コーディネータメッセージのペイロード
 * @returns Human-readable summary string
 */
export function formatCoordinatorPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');

  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];

  const msg = obj.message || obj.msg || obj.description;
  if (msg && typeof msg === 'string') parts.push(msg);

  if (obj.status && typeof obj.status === 'string') parts.push(`status=${obj.status}`);

  if (obj.taskId) parts.push(`task=${obj.taskId}`);
  if (obj.agentId && typeof obj.agentId === 'string') parts.push(`agent=${obj.agentId}`);

  if (obj.error && typeof obj.error === 'string') parts.push(`error: ${obj.error}`);

  const skipKeys = new Set([
    'message',
    'msg',
    'description',
    'status',
    'taskId',
    'agentId',
    'error',
    'timestamp',
  ]);
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.has(key) || value === null || value === undefined) continue;
    if (typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : JSON.stringify(payload).slice(0, 200);
}
