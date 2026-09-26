/**
 * agent-created-pr-adoption
 *
 * Recovers the task→PR link when an AGENT created the PR itself (CLAUDE.md
 * step 6 `gh pr create`) instead of going through the server's auto-PR path.
 * Only responsible for discovering such a PR on GitHub and recording the link —
 * it never creates, closes, or merges anything.
 *
 * Why this is needed: every task→PR lookup (taskHasLinkedPr, findOpenPrForTask)
 * reads LOCAL state (`GitHubPullRequest.linkedTaskId` / `Task.githubPrId`),
 * which only the server's own PR path writes. An agent-created PR leaves no
 * local row, so the completion gate reports the task as having no PR. The agent
 * then re-checks with `gh pr list --head <branch>`, which defaults to
 * `--state open` and returns nothing once auto-merge has already merged the PR,
 * so verify.md honestly records "PR not created" and the honesty gate bounces
 * the task — repeatedly, over work that has in fact landed. Measured on task
 * 1105 (2026-09-27): PR #826 was created 07:40 and merged 07:59, yet the task
 * burned 9 attempts and its whole cost budget before halting, while sibling
 * task 1104 — same criteria family, server-created PR — completed with no
 * bounce at all.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// NOTE: prisma comes from config/database, not the config barrel. The verify
// gate imports this module dynamically, and every test that mocks only the
// narrow database module would otherwise hit a missing barrel export (bun's
// mock.module is process-global, so one incomplete mock breaks the suite).
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { ghPath } from '../agents/orchestrator/git-operations/pr/gh-cli-path';
import { extractTaskMarkerId } from './pr-ownership';

const execFileAsync = promisify(execFile);
const log = createLogger('github:agent-created-pr-adoption');

/** Bound the lookup: this runs on a completion path, never in a loop. */
const GH_TIMEOUT_MS = 20_000;

/** How many recent PRs to scan for the task marker. */
const SCAN_LIMIT = 50;

/** One PR as returned by `gh pr list --json number,title,url,state`. */
interface GhPr {
  number: number;
  title: string;
  url: string;
  state: string;
}

/** Prefer a PR that is still open, then the highest number (most recent). */
function pickBest(candidates: GhPr[]): GhPr | null {
  if (candidates.length === 0) return null;
  const open = candidates.filter((p) => p.state.toLowerCase() === 'open');
  const pool = open.length > 0 ? open : candidates;
  return pool.reduce((best, cur) => (cur.number > best.number ? cur : best));
}

/**
 * Find a PR that carries this task's `[Task-{id}]` / `[#{id}]` title marker, in
 * ANY state (a merged PR must count — that is the case this exists for).
 *
 * @param taskId - Task whose PR to look for. / 対象タスクID
 * @returns The matching PR, or null when none is found or `gh` fails. / 一致したPR、無ければnull
 */
export async function discoverAgentCreatedPr(taskId: number): Promise<GhPr | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      ghPath(),
      [
        'pr',
        'list',
        '--state',
        'all',
        '--limit',
        String(SCAN_LIMIT),
        '--json',
        'number,title,url,state',
      ],
      // gh resolves the repository from any directory inside the checkout, and
      // the backend always runs inside it. A cwd outside a repo makes gh fail,
      // which the catch below turns into "no PR found" rather than an error.
      { cwd: process.cwd(), encoding: 'utf8', timeout: GH_TIMEOUT_MS },
    ));
  } catch (err) {
    log.warn({ err, taskId }, 'gh pr list failed — cannot look for an agent-created PR');
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim() || '[]');
  } catch (err) {
    log.warn({ err, taskId }, 'gh pr list returned unparseable JSON');
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const candidates = parsed.filter(
    (p): p is GhPr =>
      !!p &&
      typeof p === 'object' &&
      typeof (p as GhPr).number === 'number' &&
      typeof (p as GhPr).title === 'string' &&
      typeof (p as GhPr).url === 'string' &&
      typeof (p as GhPr).state === 'string' &&
      extractTaskMarkerId((p as GhPr).title) === taskId,
  );
  return pickBest(candidates);
}

/**
 * Discover an agent-created PR for the task and record the link, so every
 * local task→PR lookup can see it.
 *
 * Refuses a PR that another task already claims — the title marker is strong
 * evidence, but an existing claim always wins (same precedence as
 * pr-ownership's claim rules).
 *
 * @param taskId - Task to repair the link for. / 紐付けを復旧する対象タスク
 * @returns true when a PR was found and the link was recorded. / 紐付けできたら true
 */
export async function adoptAgentCreatedPr(taskId: number): Promise<boolean> {
  const pr = await discoverAgentCreatedPr(taskId);
  if (!pr) return false;

  // Ownership backstop. Asked against Task rather than GitHubPullRequest on
  // purpose: prNumber is unique only within a repository, so a bare prNumber
  // lookup can match another repo's PR (enforced by the
  // local/no-unscoped-pr-number-lookup lint rule). "Does another task already
  // claim this number?" is the question that actually matters here, and it
  // needs no repository scoping.
  const claimedElsewhere = await prisma.task
    .findFirst({
      where: { githubPrId: pr.number, id: { not: taskId } },
      select: { id: true },
    })
    .catch(() => null);
  if (claimedElsewhere) {
    log.warn(
      { taskId, prNumber: pr.number, claimedBy: claimedElsewhere.id },
      'PR carries this task marker but another task already claims that number — refusing to adopt',
    );
    return false;
  }

  try {
    await prisma.task.update({ where: { id: taskId }, data: { githubPrId: pr.number } });
  } catch (err) {
    log.warn(
      { err, taskId, prNumber: pr.number },
      'Failed to record the discovered PR on the task',
    );
    return false;
  }
  log.info(
    { taskId, prNumber: pr.number, state: pr.state, url: pr.url },
    'Adopted an agent-created PR that had no local link',
  );
  return true;
}
