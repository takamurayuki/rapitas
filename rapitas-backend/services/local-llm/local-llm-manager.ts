/**
 * ローカルLLMサーバー管理
 * 二段構え: Ollama優先 → llama-server sidecar フォールバック
 */
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { join, resolve } from 'path';
import { createLogger } from '../../config';
import { checkOllamaConnection } from '../../utils/ai-client/ollama-provider';
import {
  getModelPath,
  isModelDownloaded,
  getLlamaServerPath,
  isLlamaServerDownloaded,
  downloadLlamaServer,
} from './model-downloader';

const log = createLogger('local-llm:manager');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const LLAMA_SERVER_PORT = 8922;
const LLAMA_SERVER_URL = `http://localhost:${LLAMA_SERVER_PORT}`;

export type LocalLLMStatus = {
  available: boolean;
  source: 'ollama' | 'llama-server' | 'none';
  url: string;
  model: string;
  models: string[];
  modelDownloaded: boolean;
  llamaServerRunning: boolean;
  error?: string;
};

let llamaServerProcess: ChildProcess | null = null;
let llamaServerReady = false;

/**
 * llama-serverの実行ファイルパスを探す
 */
function findLlamaServerBinary(): string | null {
  const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  const searchPaths = [
    // 1. ~/.rapitas/bin/ (自動ダウンロード先)
    getLlamaServerPath(),
    // 2. Tauri sidecar (リリースビルド)
    join(process.cwd(), '..', 'rapitas-desktop', 'src-tauri', 'binaries', binaryName),
    // 3. Tauri bundled (exe横)
    join(process.execPath, '..', binaryName),
  ];

  for (const p of searchPaths) {
    const resolved = resolve(p);
    if (existsSync(resolved)) {
      log.info(`Found llama-server at: ${resolved}`);
      return resolved;
    }
  }

  log.warn('llama-server binary not found in any known location');
  return null;
}

/**
 * llama-serverプロセスを起動
 */
async function startLlamaServer(modelPath: string): Promise<boolean> {
  if (llamaServerProcess && llamaServerReady) {
    return true;
  }

  // 既に起動中なら待つ
  if (llamaServerProcess && !llamaServerReady) {
    return waitForLlamaServer();
  }

  // ポートで既にサーバーが動いていればそれを使う
  try {
    const res = await fetch(`${LLAMA_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      log.info('llama-server already running on port');
      llamaServerReady = true;
      return true;
    }
  } catch {
    // ポート空き → 起動する
  }

  const binary = findLlamaServerBinary();
  if (!binary) {
    log.warn('llama-server binary not found');
    return false;
  }

  log.info(`Starting llama-server with model: ${modelPath}`);

  try {
    llamaServerProcess = spawn(
      binary,
      [
        '--model',
        modelPath,
        '--port',
        String(LLAMA_SERVER_PORT),
        '--ctx-size',
        '2048',
        '--n-gpu-layers',
        '0', // CPU only for portability
        '--threads',
        String(Math.max(2, Math.floor((cpus().length || 4) / 2))),
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      },
    );

    llamaServerProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      log.debug(`[llama-server] ${line.trim()}`);
      if (line.includes('server is listening')) {
        llamaServerReady = true;
      }
    });

    llamaServerProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      // llama-server outputs startup info to stderr
      if (line.includes('server is listening') || line.includes('HTTP server listening')) {
        llamaServerReady = true;
      }
      log.debug(`[llama-server] ${line.trim()}`);
    });

    llamaServerProcess.on('exit', (code) => {
      log.info(`llama-server exited with code ${code}`);
      llamaServerProcess = null;
      llamaServerReady = false;
    });

    llamaServerProcess.on('error', (err) => {
      log.error({ err }, 'Failed to start llama-server');
      llamaServerProcess = null;
      llamaServerReady = false;
    });

    return waitForLlamaServer();
  } catch (error) {
    log.error({ err: error }, 'Failed to spawn llama-server');
    return false;
  }
}

/**
 * llama-serverの起動完了を待つ
 */
async function waitForLlamaServer(timeoutMs = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (llamaServerReady) return true;
    if (!llamaServerProcess) return false;

    // ヘルスチェック
    try {
      const res = await fetch(`${LLAMA_SERVER_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        llamaServerReady = true;
        return true;
      }
    } catch {
      // まだ起動中
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  log.warn('llama-server startup timed out');
  return false;
}

/**
 * llama-serverプロセスを停止
 */
export function stopLlamaServer(): void {
  if (llamaServerProcess) {
    log.info('Stopping llama-server');
    llamaServerProcess.kill('SIGTERM');
    llamaServerProcess = null;
    llamaServerReady = false;
  }
}

/**
 * ローカルLLMの状態を取得（Ollama優先チェック）
 */
export async function getLocalLLMStatus(ollamaUrl?: string): Promise<LocalLLMStatus> {
  const url = ollamaUrl || DEFAULT_OLLAMA_URL;
  const modelDownloaded = isModelDownloaded();

  // 1. Ollamaをチェック
  const ollamaCheck = await checkOllamaConnection(url);
  if (ollamaCheck.connected) {
    return {
      available: true,
      source: 'ollama',
      url,
      model: ollamaCheck.models[0] || 'qwen2.5:0.5b',
      models: ollamaCheck.models,
      modelDownloaded,
      llamaServerRunning: llamaServerReady,
    };
  }

  // 2. llama-serverをチェック
  if (llamaServerReady) {
    const llamaCheck = await checkOllamaConnection(LLAMA_SERVER_URL);
    if (llamaCheck.connected) {
      return {
        available: true,
        source: 'llama-server',
        url: LLAMA_SERVER_URL,
        model: 'qwen2.5-0.5b-instruct',
        models: llamaCheck.models.length > 0 ? llamaCheck.models : ['qwen2.5-0.5b-instruct'],
        modelDownloaded,
        llamaServerRunning: true,
      };
    }
  }

  return {
    available: false,
    source: 'none',
    url,
    model: '',
    models: [],
    modelDownloaded,
    llamaServerRunning: false,
    error: ollamaCheck.error,
  };
}

/**
 * ローカルLLMを確保する（Ollama優先 → llama-server起動）
 * タイトル生成等で使う前に呼ぶ
 */
export async function ensureLocalLLM(
  ollamaUrl?: string,
  preferredModel?: string,
): Promise<{ url: string; model: string }> {
  const url = ollamaUrl || DEFAULT_OLLAMA_URL;

  // 1. Ollamaが利用可能か
  log.info(`[ensureLocalLLM] Checking Ollama at ${url}...`);
  const ollamaCheck = await checkOllamaConnection(url);
  if (ollamaCheck.connected) {
    const model =
      preferredModel && ollamaCheck.models.includes(preferredModel)
        ? preferredModel
        : ollamaCheck.models.find((m) => m.includes('qwen')) ||
          ollamaCheck.models[0] ||
          'qwen2.5:0.5b';

    log.info(`[ensureLocalLLM] Using Ollama with model: ${model}`);
    return { url, model };
  }
  log.info(`[ensureLocalLLM] Ollama not available: ${ollamaCheck.error}`);

  // 2. llama-serverフォールバック
  log.info(
    `[ensureLocalLLM] Checking model downloaded: ${isModelDownloaded()}, llama-server downloaded: ${isLlamaServerDownloaded()}`,
  );

  if (!isModelDownloaded()) {
    throw new Error(
      'ローカルLLMモデルがダウンロードされていません。設定画面の「ローカルAI設定」からモデルをダウンロードしてください。',
    );
  }

  // llama-serverバイナリがなければ自動ダウンロード
  if (!isLlamaServerDownloaded()) {
    log.info('[ensureLocalLLM] llama-server not found, downloading automatically...');
    const dlResult = await downloadLlamaServer();
    if (!dlResult.success) {
      throw new Error(`llama-serverのダウンロードに失敗しました: ${dlResult.error}`);
    }
    log.info(`[ensureLocalLLM] llama-server downloaded to: ${dlResult.path}`);
  }

  const modelPath = getModelPath();
  log.info(`[ensureLocalLLM] Starting llama-server with model: ${modelPath}`);
  const started = await startLlamaServer(modelPath);
  if (started) {
    log.info('[ensureLocalLLM] llama-server is ready');
    return { url: LLAMA_SERVER_URL, model: 'qwen2.5-0.5b-instruct' };
  }

  throw new Error('llama-serverの起動に失敗しました。ログを確認してください。');
}

/**
 * プロセスクリーンアップ（サーバーシャットダウン時に呼ぶ）
 */
export function cleanupLocalLLM(): void {
  stopLlamaServer();
}
