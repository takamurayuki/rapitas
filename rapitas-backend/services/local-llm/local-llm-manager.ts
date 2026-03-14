/**
 * Local LLM Server Manager
 *
 * Two-tier approach: Ollama preferred, llama-server sidecar as fallback.
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
 * Find the llama-server binary path.
 */
function findLlamaServerBinary(): string | null {
  const binaryName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  const searchPaths = [
    // 1. ~/.rapitas/bin/ (auto-download destination)
    getLlamaServerPath(),
    // 2. Tauri sidecar (release build)
    join(process.cwd(), '..', 'rapitas-desktop', 'src-tauri', 'binaries', binaryName),
    // 3. Tauri bundled (next to exe)
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
 * Start the llama-server process.
 */
async function startLlamaServer(modelPath: string): Promise<boolean> {
  if (llamaServerProcess && llamaServerReady) {
    return true;
  }

  // Already starting; wait for it
  if (llamaServerProcess && !llamaServerReady) {
    return waitForLlamaServer();
  }

  // Reuse if a server is already running on the port
  try {
    const res = await fetch(`${LLAMA_SERVER_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      log.info('llama-server already running on port');
      llamaServerReady = true;
      return true;
    }
  } catch {
    // Port is free, proceed to start
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
 * Wait for llama-server startup to complete.
 */
async function waitForLlamaServer(timeoutMs = 30000): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (llamaServerReady) return true;
    if (!llamaServerProcess) return false;

    // Health check
    try {
      const res = await fetch(`${LLAMA_SERVER_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        llamaServerReady = true;
        return true;
      }
    } catch {
      // Still starting up
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  log.warn('llama-server startup timed out');
  return false;
}

/**
 * Stop the llama-server process.
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
 * Get local LLM status (checks Ollama first).
 */
export async function getLocalLLMStatus(ollamaUrl?: string): Promise<LocalLLMStatus> {
  const url = ollamaUrl || DEFAULT_OLLAMA_URL;
  const modelDownloaded = isModelDownloaded();

  // 1. Check Ollama
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

  // 2. Check llama-server
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
 * Ensure a local LLM is available (Ollama preferred, falls back to llama-server).
 * Call before using for title generation, etc.
 */
export async function ensureLocalLLM(
  ollamaUrl?: string,
  preferredModel?: string,
): Promise<{ url: string; model: string }> {
  const url = ollamaUrl || DEFAULT_OLLAMA_URL;

  // 1. Is Ollama available?
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

  // 2. llama-server fallback
  log.info(
    `[ensureLocalLLM] Checking model downloaded: ${isModelDownloaded()}, llama-server downloaded: ${isLlamaServerDownloaded()}`,
  );

  if (!isModelDownloaded()) {
    throw new Error(
      'ローカルLLMモデルがダウンロードされていません。設定画面の「ローカルAI設定」からモデルをダウンロードしてください。',
    );
  }

  // Auto-download llama-server binary if not found
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
 * Process cleanup (called on server shutdown).
 */
export function cleanupLocalLLM(): void {
  stopLlamaServer();
}
