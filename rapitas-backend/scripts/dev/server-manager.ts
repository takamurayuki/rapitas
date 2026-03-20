/**
 * Server Manager
 *
 * Manages the backend server subprocess: starting, stopping, and
 * force-killing. Deferred restart logic and file watching live in watcher.ts.
 */
import { spawn, type Subprocess } from 'bun';
import { join, resolve } from 'path';
import { createLogger } from '../../config/logger';
import { killProcessesOnPort } from './port-utils';

const pinoLog = createLogger('dev');

export const log = {
  info: (msg: string) => pinoLog.info(msg),
  success: (msg: string) => pinoLog.info(msg),
  warn: (msg: string) => pinoLog.warn(msg),
  error: (msg: string) => pinoLog.error(msg),
};

export const ROOT_DIR = resolve(import.meta.dir, '../..');
export const INDEX_FILE = join(ROOT_DIR, 'index.ts');

/** Currently running server subprocess, or null if not started. */
export let serverProcess: Subprocess | null = null;

/**
 * Sets the server process reference — used by the watcher module after restarts.
 *
 * @param proc - New subprocess or null / 新しいサブプロセス（またはnull）
 */
export function setServerProcess(proc: Subprocess | null): void {
  serverProcess = proc;
}

/** Dynamic server port — set once during main() port discovery. */
export let SERVER_PORT = parseInt(process.env.PORT || '3001', 10);

/**
 * Updates the server port used for startup and agent-active checks.
 *
 * @param port - Resolved port number / 解決済みポート番号
 */
export function setServerPort(port: number): void {
  SERVER_PORT = port;
}

/**
 * Returns the currently configured server port.
 * Use this instead of reading the exported `let` directly to ensure
 * the latest value is always returned after setServerPort() calls.
 *
 * @returns Current server port / 現在のサーバーポート
 */
export function getServerPort(): number {
  return SERVER_PORT;
}

/**
 * Terminates the server process, waiting up to 5 seconds for graceful shutdown.
 */
export async function killServerProcess(): Promise<void> {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  proc.kill();

  // Graceful shutdown may take up to 5 seconds
  const forceKillTimeout = setTimeout(() => {
    try {
      proc.kill(9); // SIGKILL
      log.warn('Force-killed server (shutdown timeout)');
    } catch {
      // Already exited
    }
  }, 5000);

  await proc.exited;
  clearTimeout(forceKillTimeout);

  // Wait for socket cleanup
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/**
 * Starts the backend server process, optionally clearing the port first.
 *
 * @param cleanupPort - Whether to kill existing processes on the port before starting / 起動前にポートをクリアするか
 */
export async function startServer(cleanupPort: boolean = false): Promise<void> {
  if (serverProcess) {
    log.info('Stopping server...');
    await killServerProcess();
    log.info('Server stopped');
  }

  // Port cleanup on first start or explicit request
  if (cleanupPort) {
    await killProcessesOnPort(SERVER_PORT);
  }

  log.info('Starting server...');
  serverProcess = spawn({
    cmd: ['bun', 'run', INDEX_FILE],
    cwd: ROOT_DIR,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '1', PORT: SERVER_PORT.toString() },
  });

  log.success(`Server started (http://localhost:${SERVER_PORT})`);
}
