/**
 * runtime-smoke/app-launcher
 *
 * Starts the app-under-test on a dynamically allocated FREE port (so it can
 * never collide with rapitas itself or another project squatting a fixed
 * port), polls until it responds, and guarantees process-tree teardown.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { createLogger } from '../../../../config/logger';
import { killProcessTreeSafely } from '../../agent-process-tracker';

const log = createLogger('runtime-smoke:launcher');

/** Max combined output lines retained for failure evidence. */
const MAX_LOG_LINES = 200;

/**
 * Allocate an OS-assigned free TCP port.
 *
 * @returns A currently-free port number / 空きポート番号
 */
export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no port allocated'))));
    });
  });
}

/** Handle for a launched app-under-test. */
export interface LaunchedApp {
  /** Last captured stdout/stderr lines (failure evidence). */
  logs(): string[];
  /** Kill the whole process tree. Idempotent. */
  stop(): void;
  pid: number | undefined;
}

/**
 * Spawn the app's start command in the worktree.
 *
 * @param command - Shell command (already port-substituted) / 起動コマンド
 * @param cwd - Worktree root / 作業ディレクトリ
 * @param port - Allocated port, also exported as env PORT / 割り当てポート
 * @returns Launch handle / 起動ハンドル
 */
export function launchApp(command: string, cwd: string, port: number): LaunchedApp {
  const lines: string[] = [];
  const push = (chunk: Buffer | string): void => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      lines.push(line.length > 400 ? `${line.slice(0, 400)}…` : line);
      if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    }
  };

  log.info({ command, cwd, port }, '[runtime-smoke] launching app under test');
  const proc: ChildProcess = spawn(command, {
    shell: true,
    cwd,
    windowsHide: true,
    env: { ...process.env, PORT: String(port), BROWSER: 'none', CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', push);
  proc.stderr?.on('data', push);
  proc.on('error', (err) => push(`[spawn error] ${err.message}`));

  let stopped = false;
  return {
    pid: proc.pid,
    logs: () => [...lines],
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (proc.pid) {
        // killProcessTreeSafely refuses the port-3001 backend, so a
        // misconfigured start command can never take rapitas down.
        killProcessTreeSafely(proc.pid);
      }
    },
  };
}

/** Emit a heartbeat log line every this many poll attempts (~7.5s at the 1.5s poll interval). */
const HEALTH_LOG_EVERY_N_ATTEMPTS = 5;

/**
 * Poll a URL until the app responds (any HTTP status < 500 counts as "up" —
 * a dev server 404 on the health path still proves the process is serving).
 *
 * The poll loop used to be silent end-to-end — a stuck launch produced no
 * server-side signal beyond the initial spawn log until the overall timeout
 * fired, making it impossible to tell whether the app was still compiling,
 * refusing every connection, or the health check itself had hung. Logs a
 * heartbeat every few attempts plus a final success/timeout summary so the
 * stall point is visible in the running server's logs, not just inferred
 * after the fact from `app.logs()`.
 *
 * @param url - Health URL / ヘルスチェックURL
 * @param timeoutMs - Overall deadline / 全体タイムアウト
 * @param logContext - Extra fields (e.g. taskId) merged into every log line for correlation. / ログ相関用の追加フィールド
 * @returns true when responsive within the deadline / 応答すれば true
 */
export async function waitForHealthy(
  url: string,
  timeoutMs: number,
  logContext: Record<string, unknown> = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  let attempt = 0;
  let lastStatus: number | undefined;
  let lastError = '';
  log.info({ url, timeoutMs, ...logContext }, '[runtime-smoke] polling health endpoint');
  while (Date.now() < deadline) {
    attempt++;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
      lastStatus = res.status;
      if (res.status < 500) {
        log.info(
          { url, attempt, elapsedMs: Date.now() - startedAt, status: res.status, ...logContext },
          '[runtime-smoke] health check succeeded',
        );
        return true;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt % HEALTH_LOG_EVERY_N_ATTEMPTS === 0) {
      log.info(
        {
          url,
          attempt,
          elapsedMs: Date.now() - startedAt,
          remainingMs: Math.max(0, deadline - Date.now()),
          lastStatus,
          lastError,
          ...logContext,
        },
        '[runtime-smoke] still waiting for health check',
      );
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  log.warn(
    {
      url,
      attempts: attempt,
      elapsedMs: Date.now() - startedAt,
      lastStatus,
      lastError,
      ...logContext,
    },
    '[runtime-smoke] health check timed out',
  );
  return false;
}
