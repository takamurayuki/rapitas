/**
 * Agent Worker Event Bridge
 *
 * Handles inbound IPC messages from the worker process:
 * decodes worker lifecycle signals, IPC responses, and orchestrator events,
 * then forwards events to SSE via realtimeService.
 * Not responsible for sending requests or managing the worker process lifecycle.
 */

import { createLogger } from '../../../config/logger';
import { realtimeService } from '../../realtime-service';
import { handleIPCResponse, type IPCResponse, type PendingRequest } from './ipc';

const logger = createLogger('agent-worker-manager:event-bridge');

/**
 * Callbacks required by the message handler.
 */
export interface WorkerMessageCallbacks {
  onReady: (pid: unknown) => void;
  onShuttingDown: (signal: unknown) => void;
}

/**
 * Dispatch an inbound IPC message from the worker to the appropriate handler.
 *
 * @param message - Raw IPC message object / IPCメッセージオブジェクト
 * @param pendingRequests - Map of in-flight requests / 未完了リクエストマップ
 * @param callbacks - Lifecycle callbacks / ライフサイクルコールバック
 */
export function handleWorkerMessage(
  message: Record<string, unknown>,
  pendingRequests: Map<string, PendingRequest>,
  callbacks: WorkerMessageCallbacks,
): void {
  try {
    const type = message.type as string;
    const data = message.data as Record<string, unknown>;

    switch (type) {
      case 'worker-ready':
        logger.info({ pid: data?.pid }, '[AgentWorkerManager] Worker ready');
        callbacks.onReady(data?.pid);
        break;

      case 'worker-shutting-down':
        logger.info({ signal: data?.signal }, '[AgentWorkerManager] Worker shutting down');
        callbacks.onShuttingDown(data?.signal);
        break;

      case 'response':
        handleIPCResponse(pendingRequests, data as unknown as IPCResponse);
        break;

      case 'orchestrator-event':
        handleOrchestratorEvent(data);
        break;

      default:
        logger.warn({ type }, '[AgentWorkerManager] Unknown message type from worker');
    }
  } catch (error) {
    logger.error({ err: error }, '[AgentWorkerManager] Error handling worker message');
  }
}

/**
 * Bridge an orchestrator event from the worker to SSE channels.
 * Broadcasts to both the execution channel and the session channel.
 *
 * @param eventData - Orchestrator event payload / オーケストレータイベントデータ
 */
export function handleOrchestratorEvent(eventData: Record<string, unknown>): void {
  const executionId = eventData.executionId as number;
  const sessionId = eventData.sessionId as number;
  const taskId = eventData.taskId as number;
  const eventType = eventData.eventType as string;
  const timestamp = eventData.timestamp as string;

  const executionChannel = `execution:${executionId}`;
  const sessionChannel = `session:${sessionId}`;

  const broadcastToBoth = (type: string, data: Record<string, unknown>) => {
    realtimeService.broadcast(executionChannel, type, data);
    realtimeService.broadcast(sessionChannel, type, data);
  };

  switch (eventType) {
    case 'execution_started':
      broadcastToBoth('execution_started', {
        executionId,
        sessionId,
        taskId,
        timestamp,
      });
      break;

    case 'execution_output': {
      const outputData = eventData.data as { output: string; isError: boolean } | undefined;
      if (outputData) {
        realtimeService.broadcast(executionChannel, 'execution_output', {
          executionId,
          output: outputData.output,
          isError: outputData.isError,
          timestamp: new Date().toISOString(),
        });
        realtimeService.broadcast(sessionChannel, 'execution_output', {
          executionId,
          output: outputData.output,
          isError: outputData.isError,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    case 'execution_completed':
      broadcastToBoth('execution_completed', {
        executionId,
        sessionId,
        taskId,
        result: eventData.data,
        timestamp,
      });
      break;

    case 'execution_failed':
      broadcastToBoth('execution_failed', {
        executionId,
        sessionId,
        taskId,
        error: eventData.data,
        timestamp,
      });
      break;

    case 'execution_cancelled':
      broadcastToBoth('execution_cancelled', {
        executionId,
        sessionId,
        taskId,
        timestamp,
      });
      break;

    default:
      logger.debug({ eventType }, '[AgentWorkerManager] Unhandled orchestrator event');
  }
}
