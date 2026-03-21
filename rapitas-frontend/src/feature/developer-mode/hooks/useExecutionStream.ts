/**
 * useExecutionStream
 *
 * Re-export barrel for execution stream hooks and types.
 * Preserves backward compatibility for all existing consumers.
 * Actual implementations live in useExecutionStreamSSE.ts and useExecutionPolling.ts.
 */

'use client';

export type {
  ExecutionEventData,
  ExecutionEvent,
  QuestionType,
  QuestionTimeoutInfo,
  ExecutionStreamState,
} from './execution-stream-types';

export { useExecutionStream } from './useExecutionStreamSSE';
export { useExecutionPolling } from './useExecutionPolling';
