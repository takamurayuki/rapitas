/**
 * log-health-suppressions.fixtures
 *
 * SUPPRESSED/KEPT fixture tables for log-health-suppressions.test.ts. Split
 * out (task 1083) to keep the test file under the COMPONENT_SPLITTING_POLICY
 * line-count ratchet — this file holds only data, all assertions stay in the
 * parent test file.
 *
 * Fixtures are REAL titles taken from the rapitas backlog on 2026-08-27, when
 * 60 of 121 open concerns came from the log-health path and almost none named
 * anything left broken.
 */

export const SUPPRESSED: [string, string][] = [
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
  // Task 1083: workflow-auto-commit.ts's own no-op skip message, distinct
  // from the gh-CLI failure above — different logger, different phrase.
  [
    'routes:workflow:auto-commit',
    'No commits between develop and bugfix/t1054-update-task — nothing to publish (skipped before gh pr create)',
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
  [
    'claude-code-agent',
    '[Claude Code] OUTPUT IDLE HANG DETECTED: No output for #s after producing # chars. Force-killing hung process.',
  ],
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
  // Task 1053: no_own_queued / no_other_running are regular branches of
  // explainQueueWait — not a defect (K-11288/K-11234).
  [
    'theme-auto-run-scheduler',
    '[ThemeAutoRunScheduler] liveOrQueuedBehind(task #) = false (reason: no_own_queued)',
  ],
  [
    'theme-auto-run-scheduler',
    '[ThemeAutoRunScheduler] liveOrQueuedBehind(task #) = false (reason: no_other_running)',
  ],
  // Task 1050: generateForTheme() catches the CLI timeout and continues
  // with the next theme (innovation-session.ts:242-253).
  ['memory:innovation-session', 'Claude CLI timed out after #ms'],
];

export const KEPT: [string, string][] = [
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
  // Task 1053: reason=lookup_error is a real lookup failure and must stay
  // visible, unlike the two regular-branch reasons above.
  [
    'theme-auto-run-scheduler',
    '[ThemeAutoRunScheduler] liveOrQueuedBehind(task #) = false (reason: lookup_error, error: …)',
  ],
  // Same CLI timeout wording from a different caller (e.g. task-spec-deriver,
  // K-8927/K-5946) is not covered by this logger-scoped rule.
  ['task-spec-deriver', 'Claude CLI timed out after #ms'],
];
