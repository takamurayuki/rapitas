/**
 * Fault Scenario: CLI Immediate Exit
 *
 * A CLI subprocess that terminates the instant it starts (before doing any
 * work) must be observable as a non-zero, non-hanging exit rather than
 * silently looking like success. Spawns a throwaway `bun -e` process that
 * exits immediately with a failure code and asserts the caller can detect it
 * within a tight bound.
 */
import { spawn } from 'bun';
import type { ScenarioContext, ScenarioResult } from './common';

/**
 * Runs the cli-immediate-exit fault scenario.
 *
 * @param _ctx - Unused; scenario is process-local, no live backend needed / 未使用（プロセス内で完結）
 * @returns Scenario result / シナリオ結果
 */
export async function run(_ctx: ScenarioContext): Promise<ScenarioResult> {
  const start = Date.now();
  const proc = spawn({
    cmd: ['bun', '-e', 'process.exit(1)'],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const exitCode = await proc.exited;
  const elapsedMs = Date.now() - start;

  if (exitCode === 0) {
    return {
      name: 'cli-immediate-exit',
      passed: false,
      detail: 'expected non-zero exit code but process reported success',
    };
  }
  if (elapsedMs > 5000) {
    return {
      name: 'cli-immediate-exit',
      passed: false,
      detail: `immediate exit took ${elapsedMs}ms — orchestrator retry detection would be slow`,
    };
  }
  return {
    name: 'cli-immediate-exit',
    passed: true,
    detail: `exit code ${exitCode} observed in ${elapsedMs}ms`,
  };
}
