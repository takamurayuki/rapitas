/**
 * Auto-commit — local save stage
 *
 * Records the task's working tree as a local commit on its branch, guarding the
 * stop intent and any review-hold binding around the write. Not responsible for
 * pre-save checks, verification, push or PR creation.
 *
 * NOTE: The route-layer helpers are injected — services must not import routes
 * (scripts/import-graph/check-import-graph.cjs).
 */
import { createLogger } from '../../../config/logger';
import type { AgentOrchestrator } from '../../agents/agent-orchestrator';
import { PUBLICATION_CANCELLED_ERROR, publicationAborted } from '../publication-cancellation-guard';
import {
  bindingDriftAfterCommit,
  checkBindingBeforeCommit,
  type PublishBinding,
} from './workflow-auto-commit-binding';
import type { AutoCommitPRResult } from './workflow-auto-commit-types';

const log = createLogger('routes:workflow:auto-commit');

type SavedCommit = NonNullable<AutoCommitPRResult['autoCommitResult']> & {
  additions?: number;
  deletions?: number;
  alreadyCommitted?: boolean;
};

/** Route-layer helpers this stage calls. */
export interface LocalSaveDeps {
  saveTaskWorkLocally: (p: {
    orchestrator: AgentOrchestrator;
    gitCwd: string;
    branchName: string | null | undefined;
    message: string;
    targetBranch: string;
  }) => Promise<SavedCommit>;
  logAutoCommit: (
    taskId: number,
    hash: string,
    branch: string,
    filesChanged: number,
    additions: number,
    deletions: number,
    alreadyCommitted: boolean,
  ) => Promise<unknown>;
}

/**
 * Save the working tree locally, writing the outcome onto `p.result`.
 *
 * @param p - Task, worktree, branch, optional binding, shared result and helpers / 入力
 * @returns The result to return immediately, or null to continue / 中断時の結果、継続なら null
 */
export async function runLocalSaveStage(p: {
  taskId: number;
  taskTitle: string;
  orchestrator: AgentOrchestrator;
  gitCwd: string;
  branchName: string | null | undefined;
  targetBranch: string;
  binding?: PublishBinding;
  result: AutoCommitPRResult;
  deps: LocalSaveDeps;
}): Promise<AutoCommitPRResult | null> {
  const { taskId, gitCwd, result } = p;
  // Boundary 2/5 — the last point before this run writes to git (locally).
  if (await publicationAborted(taskId, 'before_commit'))
    return { ...result, error: PUBLICATION_CANCELLED_ERROR };
  // An override covers one worktree + diff: checked here, by the side that
  // commits, so a change after the human looked is never recorded.
  const pre = p.binding && (await checkBindingBeforeCommit(taskId, gitCwd, p.binding));
  if (pre?.drift) return { ...result, bindingMismatch: pre.drift, error: pre.drift };
  const saved = await p.deps.saveTaskWorkLocally({
    orchestrator: p.orchestrator,
    gitCwd,
    branchName: p.branchName,
    message: `feat(task-${taskId}): ${p.taskTitle}`,
    targetBranch: p.targetBranch,
  });
  result.autoCommitResult = saved;
  if (!saved.success) {
    log.error({ taskId, error: saved.error }, `[Workflow] Local save failed for task ${taskId}`);
    return { ...result, error: `ローカル保存に失敗しました: ${saved.error}` };
  }
  // Re-check after the commit: a change made while it was being recorded is
  // in the commit, so it stays local and is never pushed.
  const after = pre?.stable && (await bindingDriftAfterCommit(gitCwd, pre.stable));
  if (after) return { ...result, bindingMismatch: after, error: after };
  log.info(`[Workflow] Local save recorded for task ${taskId}: ${saved.hash}`);
  await p.deps.logAutoCommit(
    taskId,
    saved.hash ?? '',
    saved.branch ?? '',
    saved.filesChanged ?? 0,
    saved.additions ?? 0,
    saved.deletions ?? 0,
    saved.alreadyCommitted ?? false,
  );
  return null;
}
