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
  [
    'routes:workflow:auto-commit',
    '[Workflow] Automated verification failed — aborting auto-commit/PR',
  ],
  ['exec-log', '[ExecLog:#] Execution ended with status: failed'],
  [
    'github-service:client',
    'gh command failed: gh pr create --title [Task-#] no commits between develop and bugfix/t#-x',
  ],
  ['error-handler', 'Bad Request: Failed to parse JSON'],
  ['task-executor', '[TaskExecutor] Provider failed — retrying with alternative agent config'],
];

const KEPT: [string, string][] = [
  ['prisma', 'Invalid `prisma.timelineEvent.create()` invocation'],
  ['workflow', 'Agent produced code changes WITHOUT saving plan.md — workflow violated'],
  ['git-service', 'git command failed: git merge --abort'],
  ['claude-code', '[claude-code] Model rejected by CLI — likely a provider/agent mismatch'],
  ['workflow-runner', '[WorkflowRunner] Execution error for task #: Task # not found'],
  [
    'github-service:client',
    "gh command failed: gh pr create --title [Task-#] no commits between develop and bugfix/t#-x: base sha can't be blank",
  ],
  ['error-handler', 'Prisma Error'],
  ['routes:workflow:auto-commit', 'Automated verification failed — aborting PR review'],
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

  test('"no commits between" is scoped to github-service:client only', () => {
    // Same phrase from an unrelated logger must still be filed — the rule is
    // about gh pr create no-op completions, not the phrase alone.
    expect(classifyLogSignature('some-other-logger', 'no commits between a and b').suppressed).toBe(
      false,
    );
  });

  test('an unknown line is filed rather than dropped', () => {
    // A missed suppression costs one noisy row; a wrong one hides a defect.
    expect(classifyLogSignature('whatever', 'something nobody has seen').suppressed).toBe(false);
  });

  test('"Bad Request: Failed to parse JSON" is scoped to the error-handler logger only', () => {
    // Task #702: the phrase alone must not suppress an unrelated logger reusing it.
    expect(
      classifyLogSignature('some-other-logger', 'Bad Request: Failed to parse JSON').suppressed,
    ).toBe(false);
  });

  test('"Provider failed — retrying with alternative agent config" is scoped to task-executor only', () => {
    // Task #758: workflow-provider-fallback.ts emits a similar-sounding phrase
    // ("Provider failed — retrying with Smart Router fallback") from a different
    // logger; that is a separate mechanism and must not be filed under this rule.
    expect(
      classifyLogSignature(
        'workflow-provider-fallback',
        'Provider failed — retrying with alternative agent config',
      ).suppressed,
    ).toBe(false);
  });
});
