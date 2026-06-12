/**
 * restart-loop-smoke
 *
 * Validates that the backend server survives N restart cycles and recovers
 * health each time. Runs on an isolated port to avoid touching port 3001
 * (the live agent connection — see CRITICAL CONSTRAINT in CLAUDE.md).
 *
 * CI: invoked via `bun run e2e` from .github/workflows/e2e.yml.
 * Local: PORT=3210 bun run scripts/restart-loop-smoke.ts
 */

import { spawn, type Subprocess } from 'bun';
import { appendFileSync } from 'fs';
import { join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SMOKE_PORT = parseInt(process.env.PORT ?? '3210', 10);
const CYCLES = parseInt(process.env.E2E_CYCLES ?? '3', 10);
const HEALTH_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS ?? '30000', 10);
const PORT_FREE_TIMEOUT_MS = parseInt(process.env.PORT_FREE_TIMEOUT_MS ?? '10000', 10);

const ROOT_DIR = resolve(import.meta.dir, '..');
const INDEX_FILE = join(ROOT_DIR, 'index.ts');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result from a single restart-health cycle. */
export interface CycleResult {
  cycle: number;
  /** true if /health returned "healthy" within the timeout */
  healthOk: boolean;
  /** ms taken for port to be released after kill; null = timed out (ghost socket) */
  portFreeMs: number | null;
  /** ms taken for /health to return "healthy"; null = timed out */
  healthMs: number | null;
  /** First 120 chars of the error, if any */
  error?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Exits the process if the given port is 3001 or 3000.
 * Protects the live agent server from accidental kill.
 *
 * @param port - Port to validate / バリデート対象のポート番号
 */
export function assertNotPort3001(port: number): void {
  if (port === 3001 || port === 3000) {
    console.error(
      `[smoke] FATAL: PORT=${port} is reserved for the live dev server. ` +
        `Use a different port (e.g. PORT=3210).`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Pure helper: lsof output parser
// ---------------------------------------------------------------------------

/**
 * Parses the stdout of `lsof -t -i:PORT` into a list of PIDs.
 * Returns an empty array if no processes are found.
 *
 * @param output - Raw stdout from lsof / lsof の標準出力
 * @returns Array of integer PIDs / PID の配列
 */
export function parseLsofPids(output: string): number[] {
  return output
    .trim()
    .split('\n')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

// ---------------------------------------------------------------------------
// Port free check
// ---------------------------------------------------------------------------

/**
 * Returns true when no process is listening on the given port.
 * Uses `lsof` on Linux/macOS; falls back to a TCP probe on other platforms.
 *
 * @param port - Port to check / チェックするポート番号
 */
export async function isPortFree(port: number): Promise<boolean> {
  try {
    const result = Bun.spawnSync({
      cmd: ['lsof', '-t', `-i:${port}`],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const raw = new TextDecoder().decode(result.stdout as unknown as ArrayBuffer);
    return parseLsofPids(raw).length === 0;
  } catch {
    // lsof not available — TCP probe fallback
    return isPortFreeTcp(port);
  }
}

/**
 * TCP fallback for {@link isPortFree} when `lsof` is unavailable.
 * Expects ECONNREFUSED (= port free) or a network error.
 *
 * @param port - Port to probe / プローブするポート番号
 */
async function isPortFreeTcp(port: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/health`, {
      signal: AbortSignal.timeout(500),
    });
    // Something responded → port in use
    return false;
  } catch {
    // Connection refused or timeout → port free
    return true;
  }
}

/**
 * Polls until the port is free or the timeout expires.
 * A timeout means a ghost socket was left behind.
 *
 * @param port - Port to watch / 監視するポート番号
 * @param timeoutMs - Max wait in ms / タイムアウト（ミリ秒）
 * @param pollIntervalMs - Polling interval in ms / ポーリング間隔（ミリ秒）
 * @param isPortFreeFn - Injectable checker for unit tests / テスト用インジェクション可能チェッカー
 * @returns `free` flag and elapsed ms / 解放フラグと経過時間
 */
export async function waitForPortFree(
  port: number,
  timeoutMs = PORT_FREE_TIMEOUT_MS,
  pollIntervalMs = 200,
  isPortFreeFn: (port: number) => Promise<boolean> = isPortFree,
): Promise<{ free: boolean; elapsedMs: number }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await isPortFreeFn(port)) {
      return { free: true, elapsedMs: Date.now() - start };
    }
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }

  return { free: false, elapsedMs: timeoutMs };
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

/**
 * Polls GET /health on the given port until status is "healthy" or timeout.
 *
 * @param port - Port to poll / ポーリングするポート番号
 * @param timeoutMs - Max wait in ms / タイムアウト（ミリ秒）
 * @param pollIntervalMs - Polling interval in ms / ポーリング間隔（ミリ秒）
 * @param fetchFn - Injectable fetch for unit tests / テスト用インジェクション可能 fetch
 * @returns ok flag, elapsed ms, and attempt count / 結果フラグ・経過時間・試行回数
 */
export async function waitForHealth(
  port: number,
  timeoutMs = HEALTH_TIMEOUT_MS,
  pollIntervalMs = 500,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; elapsedMs: number; attempts: number }> {
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < timeoutMs) {
    attempts++;
    try {
      const res = await fetchFn(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = (await res.json()) as { status?: string };
        if (body.status === 'healthy') {
          return { ok: true, elapsedMs: Date.now() - start, attempts };
        }
      }
    } catch {
      // Server not up yet — try again after poll interval
    }
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
  }

  return { ok: false, elapsedMs: Date.now() - start, attempts };
}

// ---------------------------------------------------------------------------
// Pure: aggregate pass/fail
// ---------------------------------------------------------------------------

/**
 * Returns true only when every cycle succeeded (health OK and no ghost socket).
 *
 * @param results - Array of cycle results / サイクル結果配列
 */
export function isAllCyclesPassed(results: CycleResult[]): boolean {
  return results.length > 0 && results.every((r) => r.healthOk && !r.error);
}

// ---------------------------------------------------------------------------
// Pure: Markdown renderer
// ---------------------------------------------------------------------------

/**
 * Renders cycle results as a Markdown summary table for $GITHUB_STEP_SUMMARY.
 *
 * @param results - Array of cycle results / サイクル結果配列
 * @param port - Port used during the smoke run / 使用したポート番号
 * @returns Markdown string / Markdown 文字列
 */
export function renderSmokeMarkdown(results: CycleResult[], port: number): string {
  const allOk = isAllCyclesPassed(results);
  const badge = allOk ? '✅ PASSED' : '❌ FAILED';

  const lines = [
    `## 再起動リカバリ Smoke テスト — ${badge}`,
    '',
    `- **ポート**: ${port}`,
    `- **サイクル数**: ${results.length} / 成功: ${results.filter((r) => r.healthOk && !r.error).length}`,
    '',
    '| サイクル | Health 回復 | ポート解放 (ms) | Health 回復時間 (ms) | 備考 |',
    '|----------|:----------:|:--------------:|:-------------------:|------|',
  ];

  for (const r of results) {
    const health = r.healthOk ? '✅' : '❌';
    const portFreeStr = r.portFreeMs !== null ? String(r.portFreeMs) : '—';
    const healthMsStr = r.healthMs !== null ? String(r.healthMs) : '—';
    const note = r.error ? r.error.substring(0, 60) : '—';
    lines.push(`| ${r.cycle} | ${health} | ${portFreeStr} | ${healthMsStr} | ${note} |`);
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Side-effecting: spawn / kill / run cycle
// ---------------------------------------------------------------------------

function spawnBackend(port: number): Subprocess {
  return spawn({
    cmd: ['bun', 'run', INDEX_FILE],
    cwd: ROOT_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
  });
}

async function killBackend(proc: Subprocess | null): Promise<void> {
  if (!proc) return;
  try {
    proc.kill();
    const forceKill = setTimeout(() => {
      try {
        proc.kill(9);
      } catch {
        // Already exited
      }
    }, 5000);
    await proc.exited;
    clearTimeout(forceKill);
  } catch {
    // Already exited
  }
  // Brief grace for OS to reclaim the socket
  await new Promise<void>((r) => setTimeout(r, 300));
}

async function runCycle(port: number, cycleIndex: number): Promise<CycleResult> {
  console.log(`\n[smoke] ▶ Cycle ${cycleIndex}/${CYCLES}: spawning backend on :${port}...`);
  const proc = spawnBackend(port);

  const healthResult = await waitForHealth(port);

  if (!healthResult.ok) {
    await killBackend(proc);
    const err = `Health timeout after ${healthResult.elapsedMs}ms (${healthResult.attempts} attempts)`;
    console.error(`[smoke] ✗ Cycle ${cycleIndex}: ${err}`);
    return { cycle: cycleIndex, healthOk: false, portFreeMs: null, healthMs: null, error: err };
  }

  console.log(`[smoke] ✓ Cycle ${cycleIndex}: health OK in ${healthResult.elapsedMs}ms`);

  await killBackend(proc);

  const portFreeResult = await waitForPortFree(port);

  if (!portFreeResult.free) {
    const err = `Ghost socket: port ${port} still LISTEN ${PORT_FREE_TIMEOUT_MS}ms after kill`;
    console.error(`[smoke] ✗ Cycle ${cycleIndex}: ${err}`);
    return {
      cycle: cycleIndex,
      healthOk: true,
      portFreeMs: null,
      healthMs: healthResult.elapsedMs,
      error: err,
    };
  }

  console.log(`[smoke] ✓ Cycle ${cycleIndex}: port free in ${portFreeResult.elapsedMs}ms`);

  return {
    cycle: cycleIndex,
    healthOk: true,
    portFreeMs: portFreeResult.elapsedMs,
    healthMs: healthResult.elapsedMs,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // CRITICAL: guard before any network I/O
  assertNotPort3001(SMOKE_PORT);

  console.log(`[smoke] 再起動リカバリ smoke — port=${SMOKE_PORT}, cycles=${CYCLES}`);
  console.log(`[smoke] backend: ${INDEX_FILE}`);

  const results: CycleResult[] = [];

  for (let i = 1; i <= CYCLES; i++) {
    const result = await runCycle(SMOKE_PORT, i);
    results.push(result);
    // Continue remaining cycles even on failure to collect full diagnostics
  }

  const markdown = renderSmokeMarkdown(results, SMOKE_PORT);
  console.log('\n' + markdown);

  // Write to GitHub Step Summary if running in CI
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, markdown, 'utf-8');
    } catch (e) {
      console.warn(`[smoke] Could not write GITHUB_STEP_SUMMARY: ${e}`);
    }
  }

  process.exit(isAllCyclesPassed(results) ? 0 : 1);
}

// NOTE: import.meta.main prevents main() from running during `bun test` imports.
if (import.meta.main) {
  await main();
}
