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
    const health = await waitForHealth(FAULT_E2E_PORT, HEALTH_TIMEOUT_MS);
    if (!health.ok) {
      console.error(`[fault-e2e] isolated backend failed health check after ${health.elapsedMs}ms`);
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
