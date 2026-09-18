/**
 * stale-pr-reaper
 *
 * Auto-closes an auto-created PR that the watcher already parked as
 * auto_merge_exhausted, whose head SHA has not moved since, once it has sat
 * CONFLICTING/DIRTY for RAPITAS_STALE_PR_DAYS (default 7) days — such a PR
 * only contributes forever to scope-overlap/merge-barrier holds otherwise
 * (task #931). Not responsible for candidate discovery beyond its own
 * GitHubPullRequest/WorkflowTransition reads, nor for the exclusion
 * performed by open-pr-files-cache.ts — those are independent consumers of
 * the same EXHAUSTED_CAUSE metadata.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { runGhCommand } from '../github/gh-client';
import { EXHAUSTED_CAUSE, parseStoredHeadSha } from './auto-merge-exhaustion';
import { recordTransition } from './transition-recorder';
import { submitConcern } from '../memory/concern-backlog-service';

const log = createLogger('workflow:stale-pr-reaper');

/** Days an exhausted+CONFLICTING/DIRTY PR must sit before it is auto-closed. */
const STALE_PR_DAYS = Math.max(1, parseInt(process.env.RAPITAS_STALE_PR_DAYS ?? '7', 10) || 7);

/** Cap on how many PRs one reaper pass closes, so one tick never spends its
 * whole budget on gh calls for a large backlog of stale PRs. */
const MAX_STALE_PR_PER_TICK = 3;

/** Marker used to make the task.description append idempotent. */
function staleNoteMarker(prNumber: number): string {
  return `[stale-pr-reaper] PR #${prNumber}`;
}

/** Injectable side effects for unit tests. */
export interface ReaperDeps {
  /** Run `gh <args>` in cwd and return stdout. */
  execGh: (args: string[], cwd: string) => Promise<string>;
  /** Clock (epoch ms). */
  now: () => number;
}

const defaultDeps: ReaperDeps = {
  execGh: (args, cwd) => runGhCommand(args, cwd),
  now: () => Date.now(),
};

/** One exhausted auto-PR candidate for the reaper to evaluate. */
interface StaleCandidate {
  pr: { id: number; integrationId: number; prNumber: number; linkedTaskId: number };
  exhaustedAt: Date;
  storedHeadSha: string | null;
}

/**
 * List open auto-PRs that carry an auto_merge_exhausted mark, oldest-parked
 * first, capped to {@link MAX_STALE_PR_PER_TICK}. Pure DB lookups only — no
 * gh calls — so the per-tick cap can be tested without a gh stub.
 *
 * @returns Candidates for the reaper to evaluate this pass / 評価対象候補
 */
export async function findStaleCandidates(): Promise<StaleCandidate[]> {
  const openPrs = await prisma.gitHubPullRequest.findMany({
    where: { state: 'open', linkedTaskId: { not: null } },
    select: { id: true, integrationId: true, prNumber: true, linkedTaskId: true },
  });
  if (openPrs.length === 0) return [];

  const linkedTaskIds = [
    ...new Set(openPrs.map((pr) => pr.linkedTaskId).filter((id): id is number => id != null)),
  ];
  const transitions = await prisma.workflowTransition.findMany({
    where: { taskId: { in: linkedTaskIds }, cause: EXHAUSTED_CAUSE },
    orderBy: { createdAt: 'desc' },
    select: { taskId: true, createdAt: true, metadata: true },
  });
  const exhaustedByTask = new Map<number, { createdAt: Date; headSha: string | null }>();
  for (const t of transitions) {
    if (!exhaustedByTask.has(t.taskId)) {
      exhaustedByTask.set(t.taskId, {
        createdAt: t.createdAt,
        headSha: parseStoredHeadSha(t.metadata),
      });
    }
  }

  const candidates: StaleCandidate[] = [];
  for (const pr of openPrs) {
    if (pr.linkedTaskId == null) continue;
    const exhausted = exhaustedByTask.get(pr.linkedTaskId);
    if (!exhausted) continue;
    candidates.push({
      pr: {
        id: pr.id,
        integrationId: pr.integrationId,
        prNumber: pr.prNumber,
        linkedTaskId: pr.linkedTaskId,
      },
      exhaustedAt: exhausted.createdAt,
      storedHeadSha: exhausted.headSha,
    });
  }
  candidates.sort((a, b) => a.exhaustedAt.getTime() - b.exhaustedAt.getTime());
  return candidates.slice(0, MAX_STALE_PR_PER_TICK);
}

/**
 * Close (via `gh pr close`) exhausted auto-PRs that have sat
 * CONFLICTING/DIRTY for {@link STALE_PR_DAYS} days with an unchanged head,
 * sync the local mirror row, append a note to the originating task, and file
 * a concern so the work can be re-attempted. Fully fail-open: any gh/DB
 * error simply skips that one PR — never throws.
 *
 * @param deps - Injectable gh/clock (tests) / テスト用注入
 * @returns How many candidates were evaluated/closed this pass / 評価・close件数
 */
export async function reapStaleAutoPrs(
  deps: ReaperDeps = defaultDeps,
): Promise<{ evaluated: number; closed: number }> {
  try {
    const candidates = await findStaleCandidates();
    let closed = 0;
    for (const candidate of candidates) {
      if (await reapOne(candidate, deps)) closed++;
    }
    return { evaluated: candidates.length, closed };
  } catch (err) {
    log.warn({ err }, '[stale-pr-reaper] Reaper pass failed');
    return { evaluated: 0, closed: 0 };
  }
}

async function reapOne(candidate: StaleCandidate, deps: ReaperDeps): Promise<boolean> {
  const { pr, exhaustedAt, storedHeadSha } = candidate;
  const ageDays = (deps.now() - exhaustedAt.getTime()) / 86_400_000;
  if (ageDays < STALE_PR_DAYS) return false;
  if (storedHeadSha == null) return false;

  const task = await prisma.task
    .findUnique({
      where: { id: pr.linkedTaskId },
      select: { id: true, themeId: true, description: true },
    })
    .catch(() => null);
  if (!task) return false;
  if ((task.description ?? '').includes(staleNoteMarker(pr.prNumber))) return false;

  const theme = task.themeId
    ? await prisma.theme
        .findUnique({ where: { id: task.themeId }, select: { workingDirectory: true } })
        .catch(() => null)
    : null;
  const cwd = theme?.workingDirectory;
  if (!cwd) return false;

  let snapshot: { headRefOid?: string; mergeStateStatus?: string; mergeable?: string };
  try {
    const stdout = await deps.execGh(
      ['pr', 'view', String(pr.prNumber), '--json', 'headRefOid,mergeStateStatus,mergeable'],
      cwd,
    );
    snapshot = JSON.parse(stdout) as typeof snapshot;
  } catch (err) {
    log.warn({ err, prNumber: pr.prNumber }, '[stale-pr-reaper] gh pr view failed — skipping');
    return false;
  }
  if (snapshot.headRefOid !== storedHeadSha) return false;
  const isDirty = snapshot.mergeStateStatus === 'DIRTY' || snapshot.mergeable === 'CONFLICTING';
  if (!isDirty) return false;

  const roundedAge = Math.floor(ageDays);
  const conflictKind = snapshot.mergeStateStatus === 'DIRTY' ? 'DIRTY' : 'CONFLICTING';
  const comment =
    `枯渇（auto_merge_exhausted）状態のままCONFLICTING/DIRTYが${roundedAge}日継続したため、` +
    `Rapitas が自動的にこのPRをcloseしました。再挑戦する場合はタスク#${pr.linkedTaskId}を確認してください。`;

  try {
    await deps.execGh(['pr', 'close', String(pr.prNumber), '--comment', comment], cwd);
  } catch (err) {
    log.warn({ err, prNumber: pr.prNumber }, '[stale-pr-reaper] gh pr close failed — skipping');
    return false;
  }

  await prisma.gitHubPullRequest
    .updateMany({
      where: { id: pr.id, state: 'open' },
      data: { state: 'closed', updatedAt: new Date(deps.now()) },
    })
    .catch((err) =>
      log.warn(
        { err, prNumber: pr.prNumber },
        '[stale-pr-reaper] Failed to sync PR state to closed',
      ),
    );

  await prisma.task
    .update({
      where: { id: pr.linkedTaskId },
      data: {
        description: `${task.description ?? ''}\n\n---\n${staleNoteMarker(pr.prNumber)} を stale（枯渇+${conflictKind}+${roundedAge}日経過）として自動 close しました。`,
      },
    })
    .catch((err) =>
      log.warn({ err, taskId: pr.linkedTaskId }, '[stale-pr-reaper] Failed to append task note'),
    );

  await recordTransition({
    taskId: pr.linkedTaskId,
    fromStatus: 'completed',
    toStatus: 'completed',
    actor: 'system',
    cause: 'stale_pr_closed',
    phase: 'verify',
    metadata: { prNumber: pr.prNumber, ageDays: roundedAge },
  }).catch(() => {});

  await submitConcern({
    title: `stale自動PR #${pr.prNumber} を自動close`,
    detail: `枯渇（auto_merge_exhausted）状態のままCONFLICTING/DIRTYが${roundedAge}日継続したため自動closeしました。タスク#${pr.linkedTaskId}で再挑戦してください。`,
    type: 'other',
    severity: 'medium',
    originTaskId: pr.linkedTaskId,
    themeId: task.themeId ?? undefined,
    source: 'stale_pr_reaper',
    dedupKey: `stale-pr:${pr.integrationId}:${pr.prNumber}`,
  }).catch((err) =>
    log.warn({ err, prNumber: pr.prNumber }, '[stale-pr-reaper] Failed to file concern'),
  );

  log.info(
    { taskId: pr.linkedTaskId, prNumber: pr.prNumber, ageDays: roundedAge },
    '[stale-pr-reaper] Closed stale exhausted auto-PR',
  );
  return true;
}
