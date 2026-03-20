/**
 * Agent Worker IPC
 *
 * IPC message types, pending request registry, and the core sendIPCRequest function
 * used to communicate with the agent worker subprocess.
 * Not responsible for worker lifecycle, event bridging, or public API methods.
 */

import type { ChildProcess } from 'child_process';
import { createLogger } from '../../../config/logger';

const logger = createLogger('agent-worker-manager:ipc');

export interface IPCRequest {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  type: string;
}

/**
 * Send an IPC request to the worker process and wait for the response.
 *
 * @param workerProcess - The worker child process / ワーカープロセス
 * @param isWorkerReady - Whether the worker has signalled readiness / ワーカー準備完了フラグ
 * @param pendingRequests - Map of in-flight requests / 未完了リクエストマップ
 * @param generateId - Function to generate a unique request ID / ID生成関数
 * @param type - IPC message type / メッセージ種別
 * @param data - IPC message payload / メッセージデータ
 * @param timeoutMs - Request timeout in milliseconds / タイムアウト（ミリ秒）
 * @returns Resolved response data / レスポンスデータ
 * @throws {Error} When worker is not ready or request times out
 */
export async function sendIPCRequest(
  workerProcess: ChildProcess | null,
  isWorkerReady: boolean,
  pendingRequests: Map<string, PendingRequest>,
  generateId: () => string,
  type: string,
  data: Record<string, unknown>,
  timeoutMs: number = 60000,
): Promise<unknown> {
  if (!workerProcess || !isWorkerReady) {
    throw new Error('Worker not ready');
  }

  const id = generateId();
  const request: IPCRequest = {
    id,
    type,
    data,
    timestamp: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`IPC request timeout: ${type}`));
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      type,
    });

    workerProcess!.send(request);
  });
}

/**
 * Resolve or reject a pending IPC request based on the worker's response.
 *
 * @param pendingRequests - Map of in-flight requests / 未完了リクエストマップ
 * @param responseData - Parsed IPC response from the worker / ワーカーからのレスポンス
 */
export function handleIPCResponse(
  pendingRequests: Map<string, PendingRequest>,
  responseData: IPCResponse,
): void {
  const { id, success, data, error } = responseData;
  const pendingRequest = pendingRequests.get(id);

  if (!pendingRequest) {
    logger.warn({ id }, '[AgentWorkerManager] Received response for unknown request');
    return;
  }

  clearTimeout(pendingRequest.timeout);
  pendingRequests.delete(id);

  if (success) {
    pendingRequest.resolve(data);
  } else {
    pendingRequest.reject(new Error(error || 'Unknown worker error'));
  }
}

/**
 * Reject all pending IPC requests with the given error.
 * Called when the worker crashes or shuts down.
 *
 * @param pendingRequests - Map of in-flight requests / 未完了リクエストマップ
 * @param error - Error to reject with / リジェクトエラー
 */
export function rejectAllPendingRequests(
  pendingRequests: Map<string, PendingRequest>,
  error: Error,
): void {
  for (const request of pendingRequests.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pendingRequests.clear();
}
