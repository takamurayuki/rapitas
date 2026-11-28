/**
 * overlap-guard-default-deps
 *
 * Production collaborators of the implementer overlap guard. Split out of
 * workflow-orchestrator-overlap-guard.ts for the file-size limit; each one
 * resolves lazily to stay out of the scheduler's static import graph.
 */
import { parsePlanFiles } from '../agents/verification/scope-check';
import { isTaskHaltActive } from './queue-terminal-task-guard';
import { makeLinkedPrStateReader } from './overlap-guard-merge-state';
import type { OverlapGuardDeps } from './workflow-orchestrator-overlap-guard';

/** Default collaborators; tests override them through guardImplementOverlap's deps. */
export const defaultOverlapGuardDeps: OverlapGuardDeps = {
  openPrs: async (themeId, cwd) => {
    const { prisma } = await import('../../config');
    const { getOpenAutoPrsForRepository } = await import('./auto-run/open-pr-files-cache');
    return getOpenAutoPrsForRepository(prisma, themeId, cwd);
  },
  prFiles: async (cwd, prNumber) => {
    const { getPrChangedFiles } = await import('./auto-run/open-pr-files-cache');
    return getPrChangedFiles(cwd, prNumber);
  },
  artifact: async (taskId, fileType) => {
    const { readWorkflowFile } = await import('./workflow-file-utils');
    return readWorkflowFile(taskId, fileType);
  },
  parseFiles: parsePlanFiles,
  overlap: async (planFiles, prFiles) => {
    const { overlappingFiles } = await import('./auto-run/auto-run-selection');
    return overlappingFiles(planFiles, prFiles);
  },
  // NOTE: Also true when the linked task went back to work (CI repair) — see
  // isLinkedPrUnlikelyToMergeSoon (2026-11-28, 1584 and 1589).
  isParked: makeLinkedPrStateReader(async () => (await import('../../config')).prisma as never),
  isHalted: async (linkedTaskId) => {
    const { prisma } = await import('../../config');
    const row = await prisma.task.findUnique({
      where: { id: linkedTaskId },
      select: { haltReason: true, status: true, workflowStatus: true },
    });
    // NOTE: Status-aware on purpose — a finished task keeps its haltReason, and
    // reading that as halted skips its open PR. See isTaskHaltActive.
    return isTaskHaltActive(row);
  },
  ownPr: async (taskId) => {
    const { prisma } = await import('../../config');
    const row = await prisma.task.findUnique({
      where: { id: taskId },
      select: { githubPrId: true },
    });
    return row?.githubPrId ?? null;
  },
  now: () => Date.now(),
};
