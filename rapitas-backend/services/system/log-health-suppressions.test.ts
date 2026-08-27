/**
 * log-health-suppressions.test
 *
 * Fixtures are REAL titles taken from the rapitas backlog on 2026-08-27, when
 * 60 of 121 open concerns came from the log-health path and almost none named
 * anything left broken.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const SUPPRESSED: [string, string][] = [
  ['git-service', 'Refusing to switch to branch feature/t#-x in the PRIMARY git working tree'],
  ['git-service', 'Refusing to create a commit: could not determine the worktree type'],
  [
    'workflow',
    '[mergeBranch] primary working tree — skipping local checkout+pull sync to protect develop',
  ],
  [
    'workflow-reconciler-queue-stall',
    '[reconciler] Queue starvation detected — restarted WorkflowRunner processing',
  ],
  ['theme-auto-run-scheduler', '[ThemeAutoRunScheduler] Task # was already queued; tracking it'],
  [
    'auto-restart-merged-code-scheduler',
    '[AutoRestartMergedCode] Working tree dirty — skipping pull/restart this tick',
  ],
  [
    'dev-restart',
    '[dev-restart] auto-run dry + new commits + no agents — restarting to apply updates',
  ],
  ['workflow-runner', '[WorkflowRunner] Already running'],
  ['model-discovery:ollama', 'Ollama probe failed'],
  [
    'runtime-smoke',
    '[runtime-smoke] launch failed with an ENVIRONMENT signature — skipping (fail-open)',
  ],
  ['agent-worker-manager:lifecycle', '[AgentWorkerManager] Worker process exited'],
  ['workflow-orchestrator', 'Server is shutting down, cannot start new execution'],
  [
    'workflow-cli-executor',
    '[WorkflowCLIExecutor] verify.md self-contradicts: claims all tests pass',
  ],
  ['agents:verification-gate', 'Automated verification failed — blocking'],
];

const KEPT: [string, string][] = [
  ['prisma', 'Invalid `prisma.timelineEvent.create()` invocation'],
  ['workflow', 'Agent produced code changes WITHOUT saving plan.md — workflow violated'],
  ['git-service', 'git command failed: git merge --abort'],
  ['claude-code', '[claude-code] Model rejected by CLI — likely a provider/agent mismatch'],
  ['workflow-runner', '[WorkflowRunner] Execution error for task #: Task # not found'],
];

describe('classifyLogSignature', () => {
  test.each(SUPPRESSED)('suppresses %s: %s', (name, msg) => {
    const v = classifyLogSignature(name, msg);
    expect(v.suppressed).toBe(true);
    // Every suppression must be able to say why nothing is left broken.
    expect(v.because).toBeTruthy();
  });

  test.each(KEPT)('keeps %s: %s', (name, msg) => {
    expect(classifyLogSignature(name, msg).suppressed).toBe(false);
  });

  test('a logger-scoped rule does not leak to other loggers', () => {
    // 'Already running' is routine for the workflow runner; elsewhere it may
    // be a real double-start, so the rule must not fire globally.
    expect(classifyLogSignature('workflow-runner', 'Already running').suppressed).toBe(true);
    expect(classifyLogSignature('payment-worker', 'Already running').suppressed).toBe(false);
  });

  test('an unknown line is filed rather than dropped', () => {
    // A missed suppression costs one noisy row; a wrong one hides a defect.
    expect(classifyLogSignature('whatever', 'something nobody has seen').suppressed).toBe(false);
  });
});
