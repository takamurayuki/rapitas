/**
 * Workflow Auto Commit — pre-save stage
 *
 * Runs BEFORE the task's working tree is saved as a local commit: the
 * protected-path tripwire and the plan-scope check on the exact diff about to
 * be recorded, plus a secret-material screen so a bulk `git add -A` can never
 * capture credentials. Then records the local commit on the task branch only
 * (no push, no PR). Not responsible for the verification gate, base sync, or
 * publication — see workflow-auto-commit.ts for the ordering.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import type { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import {
  getAllChangedFiles,
  tamperCheck,
  type VerificationCheck,
} from '../../services/agents/verification/automated-verifier';
import { evaluateScopeCheck, parsePlanFiles } from '../../services/agents/verification/scope-check';
import {
  loadPlanContent,
  protectedTestPathsFromSpec,
} from '../../services/agents/verification/verification-gate';
import { parseSpecArray } from '../../utils/common/spec-array';
import { runGitCommand } from '../../services/github/git-exec';
import {
  attributeWorkingTree,
  scanForSecrets,
} from '../../services/agents/verification/check-catalog/presave-scan';

// NOTE: task 1602 moved the secret / attribution screens to the services layer
// (presave-scan.ts) so the self-verifier can dry-run them; re-exported here
// for existing importers.
export { attributeWorkingTree } from '../../services/agents/verification/check-catalog/presave-scan';

const log = createLogger('routes:workflow:auto-commit:presave');

/**
 * Current HEAD of the worktree, or null when git cannot answer.
 *
 * @param gitCwd - Worktree / 対象 worktree
 * @returns Full SHA or null / HEAD の SHA
 */
export async function readHeadRevision(gitCwd: string): Promise<string | null> {
  const out = await runGitCommand(['rev-parse', 'HEAD'], gitCwd, { skipLog: true }).catch(() => '');
  const sha = out.trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

/**
 * Uncommitted or untracked paths in the worktree (git status --porcelain),
 * or null when git cannot answer. A non-empty list means the tree differs
 * from HEAD, i.e. from anything a push would publish.
 *
 * @param gitCwd - Worktree / 対象 worktree
 * @returns Porcelain entries, or null on error / 未コミット・未追跡の一覧
 */
export async function listWorkingTreeChanges(gitCwd: string): Promise<string[] | null> {
  try {
    const out = await runGitCommand(['status', '--porcelain', '--untracked-files=all'], gitCwd, {
      skipLog: true,
    });
    return out
      .split('\n')
      .map((l) => l.trimEnd())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** Outcome of the pre-save stage. */
export interface PreSaveCheckResult {
  /** False when a hard condition (tamper / secret) forbids saving. */
  ok: boolean;
  /** Human-readable one-line summary in the gate's `name=ok/NG(n)` style. */
  summary: string;
  changedFiles: string[];
  tamper: VerificationCheck | null;
  /** Advisory only — recorded, never blocks the save. */
  scope: VerificationCheck | null;
  /** Paths that look like secret material (blocking). */
  secrets: string[];
  /** Paths that cannot be attributed to this task's sessions (blocking). */
  unattributed: string[];
  /** Compact shape persisted on the auto-commit result. */
  record: {
    ok: boolean;
    summary: string;
    secrets: string[];
    unattributed: string[];
    scopeDetails?: string;
  };
}

/**
 * Evaluate the working tree that is about to be committed.
 *
 * @param p - Task id, worktree, and the branch the worktree was cut from / 対象
 * @returns Hard verdict (tamper/secret) plus advisory scope diagnostics / 判定
 */
export async function runPreSaveChecks(p: {
  taskId: number;
  gitCwd: string;
  preferredBaseBranch: string | null;
}): Promise<PreSaveCheckResult> {
  const changedFiles = await getAllChangedFiles(p.gitCwd, p.preferredBaseBranch);
  const planContent = await loadPlanContent(p.taskId);
  const planFiles = planContent ? parsePlanFiles(planContent) : null;
  const task = await prisma.task
    .findUnique({
      where: { id: p.taskId },
      select: {
        title: true,
        description: true,
        goals: true,
        constraints: true,
        acceptanceCriteria: true,
      },
    })
    .catch(() => null);
  const specText = [
    task?.title ?? '',
    task?.description ?? '',
    ...parseSpecArray(task?.goals),
    ...parseSpecArray(task?.constraints),
    ...parseSpecArray(task?.acceptanceCriteria),
  ].join('\n');
  // Same allowlist rule as the gate: a plan-less task may only touch the
  // protected TEST files its own spec names.
  const allow = planContent ? [] : protectedTestPathsFromSpec(specText);
  const tamper = tamperCheck(
    changedFiles,
    allow.length ? [...(planFiles ?? []), ...allow] : planFiles,
  );
  const scope = planFiles ? evaluateScopeCheck(changedFiles, planFiles) : null;
  // Name/token screen only — a floor against bulk-staging credentials, not a
  // complete secret detector (no entropy analysis, no history scan).
  const secrets = await scanForSecrets(p.gitCwd, changedFiles);
  const attribution =
    changedFiles.length === 0
      ? { ok: true, unattributed: [] as string[], windowStart: null }
      : await attributeWorkingTree({ taskId: p.taskId, gitCwd: p.gitCwd, changedFiles });
  const ok = (tamper === null || tamper.ok) && secrets.length === 0 && attribution.ok;
  const attributionLabel = attribution.ok
    ? 'ok'
    : attribution.windowStart
      ? `NG(${attribution.unattributed.length})`
      : 'unknown';
  const summary = [
    `tamper=${tamper === null ? 'n/a' : tamper.ok ? 'ok' : `NG(${tamper.errorCount})`}`,
    `secret=${secrets.length === 0 ? 'ok' : `NG(${secrets.length})`}`,
    `attribution=${attributionLabel}`,
    `scope=${scope === null ? 'n/a' : scope.ok ? 'ok' : `NG(${scope.errorCount})`}`,
  ].join(' / ');
  const unattributed = attribution.unattributed;
  if (!ok) {
    log.warn(
      { taskId: p.taskId, summary, secrets, unattributed, tamper: tamper?.details },
      '[presave] refusing to record the working tree — hard pre-save check failed',
    );
  } else if (scope && !scope.ok) {
    log.info(
      { taskId: p.taskId, scope: scope.details },
      '[presave] advisory scope deviation recorded',
    );
  }
  const record = { ok, summary, secrets, unattributed, scopeDetails: scope?.details };
  return { ok, summary, changedFiles, tamper, scope, secrets, unattributed, record };
}

/** Result of the local save. Mirrors AutoCommitPRResult.autoCommitResult. */
export interface LocalCommitOutcome {
  success: boolean;
  hash?: string;
  branch?: string;
  filesChanged?: number;
  additions?: number;
  deletions?: number;
  alreadyCommitted?: boolean;
  error?: string;
}

/**
 * Record the task's working tree as a commit on its own branch. Local only:
 * nothing is pushed and no PR is opened here. A clean tree is a no-op success
 * on HEAD, so a re-run never stacks duplicate commits.
 *
 * @param p - Orchestrator, worktree, branch and commit message inputs / 入力
 * @returns Commit metadata or a failure with its message / 保存結果
 */
export async function saveTaskWorkLocally(p: {
  orchestrator: Pick<AgentOrchestrator, 'createBranch' | 'createCommit'>;
  gitCwd: string;
  branchName: string | null | undefined;
  message: string;
  targetBranch: string;
}): Promise<LocalCommitOutcome> {
  try {
    if (p.branchName) await p.orchestrator.createBranch(p.gitCwd, p.branchName);
    const c = await p.orchestrator.createCommit(p.gitCwd, p.message, p.targetBranch);
    return {
      success: true,
      hash: c.hash,
      branch: c.branch,
      filesChanged: c.filesChanged,
      additions: c.additions,
      deletions: c.deletions,
      alreadyCommitted: c.alreadyCommitted,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
