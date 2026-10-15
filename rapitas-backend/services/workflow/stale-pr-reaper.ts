/**
 * stale-pr-reaper
 *
 * Auto-closes an auto-merge PR that has been parked exhausted (see
 * auto-merge-exhaustion.ts) for RAPITAS_STALE_PR_DAYS (default 7) with no new
 * commits since, AND that GitHub itself reports unmergeable (CONFLICTING /
 * DIRTY). Without this, a permanently-stuck open auto-PR keeps contributing
 * to scope-overlap holds and the merge barrier forever — the "40+ abandoned
 * open PRs" incident behind task 1061. Closing is a fail-open, best-effort
 * pipeline: a failed `gh pr close` skips the PR entirely (no DB/description/
 * concern side effects); a failure AFTER close (DB sync, description append,
 * concern filing) is logged and does not block the next candidate — GitHub's
 * close cannot be rolled back, so there is nothing to undo.
 * NOT responsible for deciding exhaustion (see auto-merge-exhaustion.ts) or
 * for the scope-overlap exclusion filter (see open-pr-files-cache.ts) — both
 * read the same WorkflowTransition record this module also reads.
 */
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { readExhaustionRecord } from './auto-merge-exhaustion';
import { ghPath } from './auto-merge-checks';
import { submitConcern } from '../memory/concern-backlog-service';
import type { SubmitConcernInput, ConcernFilingResult } from '../memory/concern-backlog-types';

const execAsync = promisify(exec);
const log = createLogger('workflow:stale-pr-reaper');

/** Days a candidate must sit exhausted+unmergeable before it is closed (env-tunable). */
const STALE_PR_DAYS = Math.max(1, parseInt(process.env.RAPITAS_STALE_PR_DAYS ?? '7', 10) || 7);

/** Reap at most this many stale PRs per auto-merge-watcher tick. */
export const MAX_REAP_PER_TICK = 3;

/** Injectable side effects for unit tests. */
export interface StalePrReaperDeps {
  /** Run `gh <args>` in cwd and return stdout. */
  execGh: (command: string, cwd: string) => Promise<string>;
  /** Clock (epoch ms). */
  now: () => number;
  /** File a concern for the closed PR (real implementation posts to the concern backlog). */
  submitConcern: (input: SubmitConcernInput) => Promise<ConcernFilingResult>;
}

const defaultDeps: StalePrReaperDeps = {
  execGh: async (command, cwd) => {
    const { stdout } = await execAsync(command, { cwd, encoding: 'utf8', timeout: 15_000 });
    return stdout;
  },
  now: () => Date.now(),
  submitConcern,
};

/** Result of one reap pass. */
export interface ReapResult {
  closedPrNumbers: number[];
}

interface StaleCandidateTask {
  id: number;
  themeId: number | null;
  description: string | null;
  workingDirectory: string | null;
  theme: { workingDirectory: string | null } | null;
}

/** Escape `"` so the comment string is safe to embed in a shell command. */
function escapeForShell(value: string): string {
  return value.replace(/"/g, '\\"');
}

/**
 * Reap stale, unmergeable, exhausted auto-PRs: close via `gh pr close`, sync
 * the local DB row to closed, append a note to the originating task's
 * description, and file a concern so re-attempting the work is tracked.
 * Every step after a successful close is best-effort — see the module header.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param deps - Injectable exec/clock/concern-filing (tests) / テスト用注入
 * @returns The PR numbers actually closed this pass. / このパスでcloseしたPR番号
 */
export async function reapStalePrs(
  prisma: PrismaClient,
  deps: Partial<StalePrReaperDeps> = {},
): Promise<ReapResult> {
  const { execGh, now, submitConcern: fileConcern } = { ...defaultDeps, ...deps };
  const closedPrNumbers: number[] = [];

  const candidates = await prisma.gitHubPullRequest
    .findMany({
      where: { state: 'open', linkedTaskId: { not: null } },
      select: { id: true, integrationId: true, prNumber: true, linkedTaskId: true },
    })
    .catch((err) => {
      log.warn({ err }, '[stale-pr-reaper] candidate lookup failed — skipping this pass');
      return [];
    });

  for (const candidate of candidates) {
    if (closedPrNumbers.length >= MAX_REAP_PER_TICK) break;
    const taskId = candidate.linkedTaskId;
    if (taskId == null) continue;

    const exhaustion = await readExhaustionRecord(prisma, taskId);
    if (!exhaustion.exhausted || !exhaustion.headSha || !exhaustion.exhaustedAt) continue;

    const ageDays = (now() - exhaustion.exhaustedAt.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < STALE_PR_DAYS) continue;

    const task = (await prisma.task
      .findUnique({
        where: { id: taskId },
        select: {
          id: true,
          themeId: true,
          description: true,
          workingDirectory: true,
          theme: { select: { workingDirectory: true } },
        },
      })
      .catch(() => null)) as StaleCandidateTask | null;
    if (!task) continue;

    const cwd = [task.workingDirectory, task.theme?.workingDirectory].find(
      (d): d is string => !!d && existsSync(d),
    );
    if (!cwd) continue;

    let mergeable: string | undefined;
    let mergeStateStatus: string | undefined;
    let headRefOid: string | undefined;
    try {
      const stdout = await execGh(
        `${ghPath()} pr view ${candidate.prNumber} --json mergeable,mergeStateStatus,headRefOid`,
        cwd,
      );
      const parsed = JSON.parse(stdout) as {
        mergeable?: string;
        mergeStateStatus?: string;
        headRefOid?: string;
      };
      mergeable = parsed.mergeable;
      mergeStateStatus = parsed.mergeStateStatus;
      headRefOid = parsed.headRefOid;
    } catch (err) {
      log.warn(
        { err, prNumber: candidate.prNumber },
        '[stale-pr-reaper] Failed to read PR merge state — skipping this candidate',
      );
      continue;
    }

    if (!headRefOid || headRefOid !== exhaustion.headSha) continue; // live retry — new commits pushed
    if (mergeable !== 'CONFLICTING' && mergeStateStatus !== 'DIRTY') continue;

    const reasonState = mergeStateStatus === 'DIRTY' ? 'DIRTY' : (mergeable ?? 'CONFLICTING');
    const comment = escapeForShell(
      `枯渇+${reasonState}+${Math.floor(ageDays)}日経過のため自動close（再挑戦は懸念として起票済み）`,
    );

    try {
      await execGh(`${ghPath()} pr close ${candidate.prNumber} --comment "${comment}"`, cwd);
    } catch (err) {
      log.warn(
        { err, prNumber: candidate.prNumber },
        '[stale-pr-reaper] gh pr close failed — leaving the PR open (fail-open)',
      );
      continue;
    }

    closedPrNumbers.push(candidate.prNumber);
    log.info(
      { taskId, prNumber: candidate.prNumber, ageDays: Math.floor(ageDays), reasonState },
      '[stale-pr-reaper] Closed a stale exhausted auto-PR',
    );

    await prisma.gitHubPullRequest
      .updateMany({
        where: {
          integrationId: candidate.integrationId,
          prNumber: candidate.prNumber,
          state: 'open',
        },
        data: { state: 'closed', updatedAt: new Date() },
      })
      .catch((err) =>
        log.warn({ err, prNumber: candidate.prNumber }, '[stale-pr-reaper] DB state sync failed'),
      );

    const note = `PR #${candidate.prNumber} を stale として自動 close しました（枯渇+${reasonState}+${Math.floor(ageDays)}日経過, ${new Date(now()).toISOString()}）。`;
    await prisma.task
      .update({
        where: { id: taskId },
        data: { description: task.description ? `${task.description}\n${note}` : note },
      })
      .catch((err) => log.warn({ err, taskId }, '[stale-pr-reaper] description append failed'));

    await fileConcern({
      title: `PR #${candidate.prNumber} が枯渇+競合のまま stale close されました`,
      detail: `タスク#${taskId} の自動PR #${candidate.prNumber} は auto-merge 再試行上限到達後 ${Math.floor(ageDays)} 日間 ${reasonState} のまま放置されていたため自動closeしました。再挑戦が必要です。`,
      type: 'other',
      severity: 'medium',
      location: `PR #${candidate.prNumber}`,
      originTaskId: taskId,
      themeId: task.themeId ?? undefined,
      dedupKey: `stale-pr-reaper:${candidate.prNumber}`,
    }).catch((err) =>
      log.warn({ err, prNumber: candidate.prNumber }, '[stale-pr-reaper] concern filing failed'),
    );
  }

  return { closedPrNumbers };
}
