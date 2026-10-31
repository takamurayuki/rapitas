/**
 * Fault-Injection E2E
 *
 * Runs 7 fault-injection scenarios (CLI immediate exit, stop during
 * verification, DB write failure, duplicate callback, PR-creation response
 * loss, CI failure, process restart) against an isolated backend instance —
 * see docs/eval-private-set.md for why this exists alongside the private
 * eval set. Never touches port 3001/3000 or the live dev database: spawns
 * its own backend on PORT=3211 against a throwaway SQLite file created under
 * the OS temp directory, self-initialized by config/desktop-sqlite.ts at boot
 * (no `prisma db push` — see CLAUDE.md's ban on running it manually).
 *
 * CI: invoked via `bun run eval:fault-injection` from .github/workflows/e2e.yml
 * (advisory job — see docs/eval-private-set.md).
 * Local: bun run scripts/fault-injection-e2e.ts
 */
import { spawn, type Subprocess } from 'bun';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { waitForHealth, assertNotPort3001 } from './restart-loop-smoke';
import {
  runWithTimeout,
  type ScenarioContext,
  type ScenarioResult,
} from './fault-scenarios/common';
import * as cliImmediateExit from './fault-scenarios/cli-immediate-exit';
import * as stopDuringVerification from './fault-scenarios/stop-during-verification';
import * as dbWriteFailure from './fault-scenarios/db-write-failure';
import * as duplicateCallback from './fault-scenarios/duplicate-callback';
import * as prResponseLoss from './fault-scenarios/pr-response-loss';
import * as ciFailure from './fault-scenarios/ci-failure';
import * as processRestart from './fault-scenarios/process-restart';

const FAULT_E2E_PORT = parseInt(process.env.PORT ?? '3211', 10);
const HEALTH_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT_MS ?? '30000', 10);
const ROOT_DIR = resolve(import.meta.dir, '..');
const INDEX_FILE = join(ROOT_DIR, 'index.ts');

function spawnIsolatedBackend(port: number, databaseUrl: string): Subprocess {
  return spawn({
    cmd: ['bun', 'run', INDEX_FILE],
    cwd: ROOT_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      RAPITAS_EVAL_MODE: 'true',
    },
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
  await new Promise<void>((r) => setTimeout(r, 300));
}

/** How many trailing lines of each stream to keep in a failure report. */
const FAILURE_TAIL_LINES = 80;

function tail(stream: string): string {
  const lines = stream.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(-FAILURE_TAIL_LINES).join('\n').trim();
}

/**
 * Builds the failure report for an isolated backend that never became healthy.
 *
 * Exists because the first real run of this job (PR #919, 2026-10-15) printed
 * only "failed health check after 30062ms" and then exited: the child's piped
 * stdout/stderr were never read, so the error that actually killed the backend
 * never reached the CI log and the failure was undiagnosable. Keeps the TAIL of
 * each stream, which is where a fatal error lands.
 *
 * @param elapsedMs - How long the health wait ran. / health待機の経過ミリ秒
 * @param stdout - The child's stdout. / 子プロセスのstdout
 * @param stderr - The child's stderr. / 子プロセスのstderr
 * @returns A multi-line report for the CI log. / CIログ向けの複数行レポート
 */
export function formatBackendFailure(elapsedMs: number, stdout: string, stderr: string): string {
  const out = tail(stdout);
  const err = tail(stderr);
  const lines = [`[fault-e2e] isolated backend failed health check after ${elapsedMs}ms`];
  if (!out && !err) {
    // Silence is itself the finding — the process died before logging anything.
    // Say so, so a reader does not read it as truncated output.
    lines.push('[fault-e2e] the backend produced no output on either stream (no output captured)');
    return lines.join('\n');
  }
  lines.push(`[fault-e2e] --- backend stderr (last ${FAILURE_TAIL_LINES} lines) ---`);
  lines.push(err || '(empty)');
  lines.push(`[fault-e2e] --- backend stdout (last ${FAILURE_TAIL_LINES} lines) ---`);
  lines.push(out || '(empty)');
  return lines.join('\n');
}

/** Cap on each tapped stream. A backend can log for minutes; holding all of it
 *  would trade a blind failure for an out-of-memory one. */
const MAX_TAP_CHARS = 20_000;

/**
 * A bounded sink that keeps only the TAIL of what it is given — where a fatal
 * error lands.
 *
 * @param maxChars - Most characters to retain. / 保持する最大文字数
 * @returns append/read handles. / 追記と読み出し
 */
export function createTailBuffer(maxChars: number): {
  append: (chunk: string) => void;
  read: () => string;
} {
  let text = '';
  return {
    append(chunk: string) {
      text += chunk;
      if (text.length > maxChars) text = text.slice(-maxChars);
    },
    read: () => text,
  };
}

/**
 * Copy a child stream into a sink as it arrives.
 *
 * NOTE: Incremental. This replaced a readBackendStreams() that drained each
 * pipe to EOF with `new Response(stream).text()`, which can only finish once
 * the child is gone — so it was usable on the startup path alone. A scenario
 * that fails mid-run needs the log WHILE the backend still holds the pipe
 * open (#1000), so the tap starts at spawn and the buffer reads at any point.
 *
 * @param stream - The child's stdout or stderr. / 子プロセスのストリーム
 * @param sink - Receives decoded text. / 受け手
 */
async function tapStream(stream: unknown, sink: (text: string) => void): Promise<void> {
  if (!stream || typeof stream === 'number') return;
  const decoder = new TextDecoder();
  try {
    for await (const chunk of stream as ReadableStream<Uint8Array>) {
      sink(decoder.decode(chunk, { stream: true }));
    }
  } catch {
    // The pipe closing mid-read is the normal end of a killed backend.
  }
}

/**
 * Builds the backend-side context for a FAILED scenario.
 *
 * Exists because `Fault Injection E2E` kept reporting
 * `task creation failed: HTTP 500` with no indication of why the backend
 * answered 500 — formatBackendFailure covers only the startup path (#1000).
 * Deliberately says nothing about a health check, which is that other path.
 *
 * @param stdout - Tapped stdout. / 取得したstdout
 * @param stderr - Tapped stderr. / 取得したstderr
 * @returns A multi-line report for the CI log. / CIログ向けレポート
 */
export function formatScenarioBackendContext(stdout: string, stderr: string): string {
  const out = tail(stdout);
  const err = tail(stderr);
  const lines = ['[fault-e2e] a scenario failed — backend output follows'];
  if (!out && !err) {
    // Silence is itself the finding: the backend answered without logging,
    // which points somewhere different than a stack trace would.
    lines.push('[fault-e2e] the backend produced no output on either stream (no output captured)');
    return lines.join('\n');
  }
  lines.push(`[fault-e2e] --- backend stderr (last ${FAILURE_TAIL_LINES} lines) ---`);
  lines.push(err || '(empty)');
  lines.push(`[fault-e2e] --- backend stdout (last ${FAILURE_TAIL_LINES} lines) ---`);
  lines.push(out || '(empty)');
  return lines.join('\n');
}

/**
 * Renders scenario results as a Markdown summary table, mirroring
 * restart-loop-smoke.ts's renderSmokeMarkdown so both E2E jobs share a
 * consistent report style in $GITHUB_STEP_SUMMARY.
 *
 * @param results - Scenario outcomes / シナリオ結果一覧
 * @returns Markdown string / Markdown 文字列
 */
export function renderFaultInjectionMarkdown(results: ScenarioResult[]): string {
  const allOk = results.length > 0 && results.every((r) => r.passed);
  const badge = allOk ? '✅ PASSED' : '❌ FAILED';
  const lines = [
    `## 故障注入 E2E — ${badge}`,
    '',
    `- **シナリオ数**: ${results.length} / 成功: ${results.filter((r) => r.passed).length}`,
    '',
    '| シナリオ | 結果 | 詳細 |',
    '|----------|:----:|------|',
  ];
  for (const r of results) {
    lines.push(`| ${r.name} | ${r.passed ? '✅' : '❌'} | ${r.detail.slice(0, 100)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  assertNotPort3001(FAULT_E2E_PORT);

  const tmpDir = mkdtempSync(join(tmpdir(), 'rapitas-fault-e2e-'));
  const dbPath = join(tmpDir, 'fault-e2e.db');
  const databaseUrl = `file:${dbPath}`;

  console.log(`[fault-e2e] 故障注入E2E — port=${FAULT_E2E_PORT}, db=${databaseUrl}`);

  let proc: Subprocess | null = null;
  const results: ScenarioResult[] = [];

  try {
    proc = spawnIsolatedBackend(FAULT_E2E_PORT, databaseUrl);
    // Tap both streams from the moment it starts. A scenario that fails
    // mid-run needs the backend's log while the child still holds the pipe
    // open, which draining to EOF cannot give (#1000).
    const stdoutTail = createTailBuffer(MAX_TAP_CHARS);
    const stderrTail = createTailBuffer(MAX_TAP_CHARS);
    void tapStream(proc.stdout, stdoutTail.append);
    void tapStream(proc.stderr, stderrTail.append);
    const health = await waitForHealth(FAULT_E2E_PORT, HEALTH_TIMEOUT_MS);
    if (!health.ok) {
      // Kill first so the taps see EOF and flush what the child wrote on its
      // way out; killBackend already settles for 300ms afterwards.
      await killBackend(proc);
      proc = null;
      console.error(formatBackendFailure(health.elapsedMs, stdoutTail.read(), stderrTail.read()));
      process.exit(1);
    }

    const ctx: ScenarioContext = {
      port: FAULT_E2E_PORT,
      baseUrl: `http://localhost:${FAULT_E2E_PORT}`,
      cwd: ROOT_DIR,
    };

    results.push(await runWithTimeout('cli-immediate-exit', () => cliImmediateExit.run(ctx)));
    results.push(
      await runWithTimeout('stop-during-verification', () => stopDuringVerification.run(ctx)),
    );
    results.push(await runWithTimeout('db-write-failure', () => dbWriteFailure.run(ctx)));
    results.push(await runWithTimeout('duplicate-callback', () => duplicateCallback.run(ctx)));
    results.push(await runWithTimeout('pr-response-loss', () => prResponseLoss.run(ctx)));
    results.push(await runWithTimeout('ci-failure', () => ciFailure.run(ctx)));

    // process-restart kills `proc` itself — run last and hand it the kill fn.
    const procRef = proc;
    results.push(
      await runWithTimeout('process-restart', () =>
        processRestart.run(ctx, () => killBackend(procRef)),
      ),
    );
    proc = null; // already killed by the scenario
    if (results.some((r) => !r.passed)) {
      // Printed before the summary table so the cause sits next to the symptom
      // in the CI log rather than scrolled away above it.
      console.error(formatScenarioBackendContext(stdoutTail.read(), stderrTail.read()));
    }
  } finally {
    await killBackend(proc);
    rmSync(tmpDir, { recursive: true, force: true });
  }

  const markdown = renderFaultInjectionMarkdown(results);
  console.log('\n' + markdown);

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      const { appendFileSync } = await import('fs');
      appendFileSync(summaryPath, markdown, 'utf-8');
    } catch (e) {
      console.warn(`[fault-e2e] Could not write GITHUB_STEP_SUMMARY: ${e}`);
    }
  }

  process.exit(results.length > 0 && results.every((r) => r.passed) ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
