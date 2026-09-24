/**
 * log-health-suppressions.test
 *
 * Fixtures are REAL titles taken from the rapitas backlog on 2026-08-27, when
 * 60 of 121 open concerns came from the log-health path and almost none named
 * anything left broken.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

const SUPPRESSED: [string, string][] = [
  [
    'execution-file-logger',
    "【Prompt Too Long】Claude Code CLI reported the prompt/context was too long (exit code #). The session's accumulated transcript has likely exceeded the model's context window — resuming this same session via --resume will very likely repeat this failure. Cold-start with a short structured handoff instead.",
  ],
  [
    'execution-file-logger',
    'Process exited with code # 【Session Resume Mode】Session ID: # 【Warning】Execution time of #ms is very short.',
  ],
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
  [
    'workflow-reconciler-queue-stall',
    '[reconciler] Queue has items while the runner is already processing — a kick cannot help; not restarting',
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
  [
    'routes:workflow:auto-commit',
    '[Workflow] Automated verification failed — holding the local commit, no push/PR',
  ],
  ['routes:workflow:auto-commit:publish-guard', '[Workflow] pre-PR base sync blocked PR creation'],
  [
    'workflow-cli-executor',
    '[WorkflowCLIExecutor] verify.md explicitly reports a failed or partial overall verdict; repair is required. 未達: «技術検証（テスト・型・lint・format）自体はすべて合格している。判定を❌とする理由は下記「未解決の懸念事項」に記載する受入基準の未充足による。» / «受入基準2: 欠陥か正常動作かの最終判定とその根拠を記録 | ❌ 未完了 | research.mdは選択肢A/B/Cを列挙するのみで最終決定なし。verify.mdにも判定なし»',
  ],
  ['exec-log', '[ExecLog:#] Execution ended with status: failed'],
  [
    'claude-code-agent',
    '[claude-code] Prompt/context too long — failing fast so the session is excluded from future resumes.',
  ],
  [
    'github-service:client',
    'gh command failed: gh pr create --title [Task-#] no commits between develop and bugfix/t#-x',
  ],
  ['error-handler', 'Bad Request: Failed to parse JSON'],
  ['error-handler', 'Failed to parse JSON request body'],
  ['ai:provider-cooldown', 'Provider placed in cooldown'],
  ['routes:workflow:handlers:files', '[Workflow] Phase critic gate timed out — failing open'],
  ['workflow:completion-gate', '[CompletionGate] diff check failed — failing open'],
  [
    'workflow:verify-self-repair',
    '[verify-repair] Non-convergence check failed — failing open (no cutoff)',
  ],
  [
    'task-executor',
    '[TaskExecutor] Detected provider error in successful output — forcing fallback',
  ],
  ['task-executor', '[TaskExecutor] Provider failed — retrying with alternative agent config'],
  ['memory:task-queue', 'Stuck processing task requeued as pending'],
  ['claude-code-agent', '[resolveCliPath] Failed to resolve claude, using relative path'],
  ['claude-code-agent', 'Command failed: taskkill /PID # /T /F'],
  ['codex-cli-agent', 'Command failed: taskkill /PID # /T /F'],
  ['gemini-cli-agent:process-manager', 'Command failed: taskkill /PID # /T /F'],
  [
    'git-operations/worktree-ops',
    "Command failed: git worktree remove <path> … fatal: '<path>' is not a working tree",
  ],
  [
    'auto-run:idle-timer',
    '[auto-run-idle-timer] Idle-stop timer expired for theme # (enabled=false)',
  ],
  ['routes:workflow:auto-commit', '[Workflow] Worktree cleanup failed: <path>'],
  ['runtime-smoke:launcher', '[runtime-smoke] health check timed out'],
  [
    'git-operations/pr-merge-ops',
    'Command failed: <path> Files\\GitHub CLI\\gh.exe pr merge # … failed to delete local branch feature/t#',
  ],
  // Task 1040: the recurring event-loop-lag WARN (K-8776/K-9142/K-11160/K-11233).
  ['event-loop-lag', 'Event loop stalled ~#.#s'],
  // Task 1046: stale_task is expected-hold classified (#1041) and never
  // reaches this generic-Error path; stale process pre-dates #1041
  // (K-11230/K-11231/K-11287).
  ['error-handler', 'Reviewed external work held: stale_task'],
  // Task 1050: generateForTheme() catches the CLI timeout and continues
  // with the next theme (innovation-session.ts:242-253).
  ['memory:innovation-session', 'Claude CLI timed out after #ms'],
];

const KEPT: [string, string][] = [
  [
    'claude-code',
    '【Prompt Too Long】Claude Code CLI reported the prompt/context was too long (exit code #).',
  ],
  ['claude-code', 'Process exited with code # 【Session Resume Mode】Session ID: #'],
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
  ['memory:task-queue', 'Stuck processing task moved to dead_letter'],
  ['claude-code-agent', 'process.kill() also failed'],
  [
    'git-operations/worktree-ops',
    "Command failed: git worktree remove <path> … error: failed to delete '<path>': Permission denied",
  ],
  ['git-operations/worktree-ops', 'Could not remove <path> after retries (held handles)'],
  // A real merge failure (no local-branch cleanup wording) must stay visible.
  [
    'git-operations/pr-merge-ops',
    'Command failed: <path> Files\\GitHub CLI\\gh.exe pr merge # … Pull request is not mergeable',
  ],
  // Same wording from another logger is not this rule's business.
  [
    'some-other-logger',
    'Command failed: gh.exe pr merge # … failed to delete local branch feature/t#',
  ],
  ['git-operations/worktree-ops', 'REFUSED fs cleanup: <path> contains .git directory'],
  ['auto-run:idle-timer', '[auto-run-idle-timer] stopThemeForIdleTimeout write failed'],
  [
    'git-operations/worktree-ops',
    '[cleanupOrphanedWorktrees] Failed to remove orphaned directory after retries: <path>',
  ],
  // A genuinely unexpected hold reason (not in EXPECTED_REPLAN_HOLD_REASONS)
  // still takes the generic-Error path and must remain visible.
  ['error-handler', 'Reviewed external work held: some_unexpected_reason'],
  // Same CLI timeout wording from a different caller (e.g. task-spec-deriver,
  // K-8927/K-5946) is not covered by this logger-scoped rule.
  ['task-spec-deriver', 'Claude CLI timed out after #ms'],
];

describe('classifyLogSignature', () => {
  test('the real task-1011 gh pr merge line is suppressed after normalization', () => {
    const raw = [
      'Command failed: C:\\Program Files\\GitHub CLI\\gh.exe pr merge 778 --merge --delete-branch',
      "failed to delete local branch feature/t1011-update-execution-agent: failed to run git: error: cannot delete branch 'feature/t1011-update-execution-agent' used by worktree at 'C:/Projects/rapitas/.worktrees/task-1011-b7839f22'",
      '',
    ].join('\n');
    expect(
      classifyLogSignature('git-operations/pr-merge-ops', normalizeMessage(raw)).suppressed,
    ).toBe(true);
  });

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

  test('"Failed to parse JSON request body" is scoped to the error-handler logger only', () => {
    // Task #861: the phrase alone must not suppress an unrelated logger reusing it.
    expect(
      classifyLogSignature('some-other-logger', 'Failed to parse JSON request body').suppressed,
    ).toBe(false);
  });

  test('"Provider placed in cooldown" is scoped to the ai:provider-cooldown logger only', () => {
    // Task #759: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature('some-other-logger', 'Provider placed in cooldown').suppressed,
    ).toBe(false);
  });

  test('"Detected provider error in successful output — forcing fallback" is scoped to task-executor only', () => {
    // Task #782: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature(
        'some-other-logger',
        'Detected provider error in successful output — forcing fallback',
      ).suppressed,
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

  test('"Stuck processing task requeued as pending" is scoped to memory:task-queue only', () => {
    // Task #761: the phrase alone must not suppress an unrelated logger reusing it.
    expect(
      classifyLogSignature('some-other-logger', 'Stuck processing task requeued as pending')
        .suppressed,
    ).toBe(false);
  });

  test('the dead_letter transition stays visible even though the requeue is suppressed', () => {
    // Task #761: a real permanent failure must not be swallowed by the requeue rule.
    expect(
      classifyLogSignature('memory:task-queue', 'Stuck processing task moved to dead_letter')
        .suppressed,
    ).toBe(false);
  });

  test('"Prompt/context too long — failing fast" is scoped to the claude-code-agent logger only', () => {
    // Task #1036: the fail-fast line is the guard working; the same phrase elsewhere stays visible.
    expect(
      classifyLogSignature(
        'some-other-logger',
        '[claude-code] Prompt/context too long — failing fast so the session is excluded from future resumes.',
      ).suppressed,
    ).toBe(false);
  });

  test('"[resolveCliPath] Failed to resolve" is scoped to the claude-code-agent logger only', () => {
    // Task #779: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature(
        'some-other-logger',
        '[resolveCliPath] Failed to resolve claude, using relative path',
      ).suppressed,
    ).toBe(false);
  });

  test('"Command failed: taskkill" is scoped to the CLI-agent loggers only', () => {
    // Task #810: an unrelated logger hitting the same execSync failure text
    // (e.g. a git-operations timeout) must still be filed.
    expect(
      classifyLogSignature('some-other-logger', 'Command failed: taskkill /PID # /T /F').suppressed,
    ).toBe(false);
  });

  test('a failed process.kill() fallback after taskkill stays visible', () => {
    // Task #810: only the first taskkill attempt is suppressed. If the
    // process.kill() fallback also fails, that is a distinct, unsuppressed
    // signature — the real-defect case must not be hidden.
    expect(classifyLogSignature('claude-code-agent', 'process.kill() also failed').suppressed).toBe(
      false,
    );
  });

  test('"git worktree remove ... is not a working tree" is scoped to the worktree-ops logger only', () => {
    // Task #824: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature(
        'some-other-logger',
        "Command failed: git worktree remove <path> … fatal: '<path>' is not a working tree",
      ).suppressed,
    ).toBe(false);
  });

  test('a Permission Denied worktree-remove failure (K-7336) stays visible', () => {
    // Task #824: only the "is not a working tree" fallback is a no-op self-heal.
    // A Permission Denied failure means the fs fallback did not run cleanly and
    // must not be hidden by this rule.
    expect(
      classifyLogSignature(
        'git-operations/worktree-ops',
        "Command failed: git worktree remove <path> … error: failed to delete '<path>': Permission denied",
      ).suppressed,
    ).toBe(false);
  });

  test('"Idle-stop timer expired" is scoped to the auto-run:idle-timer logger only', () => {
    // Task #823: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature(
        'some-other-logger',
        '[auto-run-idle-timer] Idle-stop timer expired for theme # (enabled=false)',
      ).suppressed,
    ).toBe(false);
  });

  test('a failed idle-stop DB write stays visible even though the expiry record is suppressed', () => {
    // Task #823: only the successful stop record is suppressed. If the DB
    // update itself fails, that is a distinct, unsuppressed signature — the
    // real-defect case must not be hidden.
    expect(
      classifyLogSignature(
        'auto-run:idle-timer',
        '[auto-run-idle-timer] stopThemeForIdleTimeout write failed',
      ).suppressed,
    ).toBe(false);
  });

  test('"[Workflow] pre-PR base sync blocked PR creation" is scoped to the publish-guard logger only', () => {
    // Task #1048/K-11293: the guard withholds PR creation on an unresolved
    // base-sync conflict or a failed post-sync reverification — the guard
    // working as designed, not a defect. An unrelated logger reusing the
    // phrase must still be filed.
    expect(
      classifyLogSignature('some-other-logger', '[Workflow] pre-PR base sync blocked PR creation')
        .suppressed,
    ).toBe(false);
  });

  test('"[Workflow] Worktree cleanup failed" is scoped to routes:workflow:auto-commit only', () => {
    // Task #821/K-8422: an unrelated logger reusing this phrasing must still be filed.
    expect(
      classifyLogSignature('some-other-logger', '[Workflow] Worktree cleanup failed: <path>')
        .suppressed,
    ).toBe(false);
  });

  test('a permanently stuck worktree removal stays visible via the scheduler signature', () => {
    // Task #821: the immediate-attempt warn is suppressed because the 30-minute
    // cleanupOrphanedWorktrees scheduler retries, but a retry-exhausted failure
    // from that scheduler is a distinct, unsuppressed signature.
    expect(
      classifyLogSignature(
        'git-operations/worktree-ops',
        '[cleanupOrphanedWorktrees] Failed to remove orphaned directory after retries: <path>',
      ).suppressed,
    ).toBe(false);
  });

  test('"[cleanupOrphanedWorktrees] removeWorktree refused" is suppressed only for the worktree-ops logger', () => {
    // Task #1029: a refusal is the dirty-work guard working; the root cause is
    // logged by worktree-remove.ts under its own signature.
    for (const msg of [
      '[cleanupOrphanedWorktrees] removeWorktree refused for # session(s) (ids: #): <path>',
      '[cleanupOrphanedWorktrees] removeWorktree refused for # session(s) (ids: #,#,#,#,#,#): <path>',
    ]) {
      expect(classifyLogSignature('git-operations/worktree-ops', msg).suppressed).toBe(true);
      expect(classifyLogSignature('some-other-logger', msg).suppressed).toBe(false);
    }
  });

  test('the root-cause "Preserving uncommitted work" warn stays visible', () => {
    expect(
      classifyLogSignature(
        'git-operations/worktree-ops',
        '[removeWorktree] Preserving uncommitted work',
      ).suppressed,
    ).toBe(false);
  });

  test('"[runtime-smoke] health check timed out" is scoped to the runtime-smoke:launcher logger only', () => {
    // Task #862: an unrelated logger reusing this phrase must still be filed.
    expect(
      classifyLogSignature('some-other-logger', '[runtime-smoke] health check timed out')
        .suppressed,
    ).toBe(false);
  });

  test('the live-preview health-check timeout stays visible under its own logger', () => {
    // Task #862: preview-session-manager.ts uses a distinct logger and message
    // ("preview-session" / "dev server did not become healthy in time") — that
    // path is a manual, user-triggered preview and is intentionally out of
    // scope for this rule, so it must not be caught by name-only matching.
    expect(
      classifyLogSignature('preview-session', '[preview] dev server did not become healthy in time')
        .suppressed,
    ).toBe(false);
  });

  test('the real event-loop-lag WARN is suppressed after normalization (task 1040)', () => {
    expect(
      classifyLogSignature('event-loop-lag', normalizeMessage('Event loop stalled ~3.8s'))
        .suppressed,
    ).toBe(true);
  });

  test('"Event loop stalled" is scoped to the event-loop-lag logger only', () => {
    // Task 1040: an unrelated logger reusing this phrase must still be filed.
    expect(classifyLogSignature('some-other-logger', 'Event loop stalled ~#.#s').suppressed).toBe(
      false,
    );
  });

  test('the event-loop-lag self-heal restart ERROR stays visible', () => {
    // Task 1040: only the sub-threshold WARN is suppressed. A catastrophic
    // stall triggers a distinct ERROR-level message that must not be hidden.
    expect(
      classifyLogSignature('event-loop-lag', '[event-loop-lag] Self-healing restart triggered')
        .suppressed,
    ).toBe(false);
  });

  test('"Reviewed external work held: stale_task" is scoped to the error-handler logger only', () => {
    // Task 1046: the phrase alone must not suppress an unrelated logger, and
    // a hold reason outside EXPECTED_REPLAN_HOLD_REASONS must stay visible
    // even under error-handler since it still takes the generic-Error path.
    expect(
      classifyLogSignature('some-other-logger', 'Reviewed external work held: stale_task')
        .suppressed,
    ).toBe(false);
    expect(
      classifyLogSignature('error-handler', 'Reviewed external work held: budget_exhausted')
        .suppressed,
    ).toBe(false);
  });

  test('"verify.md explicitly reports a failed or partial overall verdict" is scoped to the workflow-cli-executor logger only', () => {
    // Task 1049: this WARN is the epilogue's fail-soft observability log for
    // validateVerify's hasNonpassingVerifyVerdict branch — repair/block itself
    // is handled elsewhere (status-transition.ts / verify-gate.ts). Scoping to
    // the logger keeps an unrelated source reusing this phrase filed.
    expect(
      classifyLogSignature(
        'some-other-logger',
        'verify.md explicitly reports a failed or partial overall verdict; repair is required.',
      ).suppressed,
    ).toBe(false);
    expect(
      classifyLogSignature(
        'workflow-cli-executor',
        '[WorkflowCLIExecutor] verify.md explicitly reports a failed or partial overall verdict; repair is required. 未達: «...»',
      ).suppressed,
    ).toBe(true);
  });
});
