/**
 * Shared orchestrator singleton instance
 *
 * メインプロセスでは AgentWorkerManager を通じてワーカープロセスに委譲し、
 * エージェント実行をメインプロセスのイベントループから分離する。
 *
 * AgentWorkerManager は AgentOrchestrator と同じメソッドインターフェースを持ち、
 * IPC経由でワーカープロセスのオーケストレーターに処理を委譲する。
 * SSEブロードキャストはワーカーからのIPCイベントをマネージャーが受信し、
 * realtimeService に転送することで実現する。
 */
import { AgentWorkerManager } from './agents/agent-worker-manager';

// メインプロセスでは AgentWorkerManager を使用
const workerManager = AgentWorkerManager.getInstance();

// ルーターとの後方互換性のため orchestrator としてエクスポート
export { workerManager as orchestrator };

// ワーカーマネージャー自体もエクスポート（initialize/shutdown 呼び出し用）
export { workerManager };

/**
 * サーバー停止コールバック
 * index.ts で app.stop() を登録し、system-router のシャットダウンで呼び出す。
 */
let _serverStopCallback: (() => Promise<void> | void) | null = null;

export function setServerStopCallback(callback: () => Promise<void> | void): void {
  _serverStopCallback = callback;
}

export async function stopServer(): Promise<void> {
  if (_serverStopCallback) {
    await _serverStopCallback();
  }
}
