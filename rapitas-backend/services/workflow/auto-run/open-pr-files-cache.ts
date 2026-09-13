/**
 * OpenPrFilesCache
 *
 * Lists a theme's OPEN auto-created PRs (GitHubPullRequest state='open' with a
 * linkedTaskId belonging to the theme) and fetches each PR's changed files via
 * `gh pr view <n> --json files,state,headRefOid`, memoized per repository and PR with a TTL so
 * the 12-second scheduler tick never stampedes the GitHub API. gh failures are
 * fail-open (empty file list → no deferral) — a broken gh must not stop task
 * selection. Also excludes PRs the watcher parked as auto_merge_exhausted
 * whose head commit has not moved since — those no longer contribute to
 * scope-overlap/merge-barrier decisions (see auto-merge-exhaustion.ts).
 * Not responsible for overlap decisions — see auto-run-selection.ts.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { EXHAUSTED_CAUSE, parseStoredHeadSha } from '../auto-merge-exhaustion';

const execAsync = promisify(exec);
const log = createLogger('workflow:open-pr-files-cache');

/** TTL for one PR's changed-file list (= 5 scheduler polls of 12 s). */
export const PR_FILES_CACHE_TTL_MS = 60_000;

/** One open auto-created PR relevant to scope-overlap scheduling. */
export interface OpenAutoPr {
  prNumber: number;
  linkedTaskId: number | null;
  /** PR row creation time; consumers use it to ignore stale PRs. */
  createdAt: Date | null;
}

interface CacheEntry {
  files: string[];
  state: string | null;
  /** Current head commit SHA (headRefOid), null when unreadable. */
  headSha: string | null;
  expiresAt: number;
}

// Repository/PR-keyed memo. Failures are cached too (as []) so a persistently
// broken gh is retried at most once per TTL window instead of every tick.
const cache = new Map<string, CacheEntry>();

/** Clear the memo (test isolation helper). */
export function clearPrFilesCache(): void {
  cache.clear();
}

/** Resolve the platform-specific `gh` CLI invocation path (mirrors auto-merge-checks). */
function ghPath(): string {
  return process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
}

/** Injectable side effects for unit tests. */
export interface PrFilesDeps {
  /** Run `gh <args>` in cwd and return stdout. */
  execGh: (command: string, cwd: string) => Promise<string>;
  /** Clock (epoch ms). */
  now: () => number;
}

const defaultDeps: PrFilesDeps = {
  execGh: async (command, cwd) => {
    // NOTE: 15s cap — an uncapped gh (credential prompt, dead network) blocked
    // the runner's whole processQueue for 16 minutes on 2026-08-30. A timeout
    // surfaces as an exec error and the caller already fails open on those.
    const { stdout } = await execAsync(command, { cwd, encoding: 'utf8', timeout: 15_000 });
    return stdout;
  },
  now: () => Date.now(),
};

/**
 * The theme's open auto-created PRs (state='open' + linkedTaskId in the
 * theme's tasks). No relation is assumed between the PR and Task tables —
 * task ids are collected first, mirroring pr-duplicate-guard's query shape.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme whose tasks to scan / 対象テーマ
 * @returns Open auto-PRs, [] on any DB error (fail-open) / オープン自動PR一覧
 */
export async function getOpenAutoPrsForTheme(
  prisma: PrismaClient,
  themeId: number,
  deps: PrFilesDeps = defaultDeps,
): Promise<OpenAutoPr[]> {
  try {
    const tasks = await prisma.task.findMany({
      where: { themeId },
      select: { id: true },
    });
    if (tasks.length === 0) return [];
    const rows = await prisma.gitHubPullRequest.findMany({
      where: { state: 'open', linkedTaskId: { in: tasks.map((t) => t.id) } },
      select: { prNumber: true, linkedTaskId: true, createdAt: true },
    });
    if (rows.length === 0) return rows;

    // Exhausted (auto_merge_exhausted) + head-unchanged PRs stop contributing
    // to scope-overlap/merge-barrier decisions — the watcher parked them and
    // will only resume watching if the head moves (see auto-merge-exhaustion.ts).
    // Lookup failures leave the map empty, which excludes nothing (fail-safe:
    // keep candidates in the result rather than risk hiding a real overlap).
    const linkedTaskIds = [
      ...new Set(rows.map((r) => r.linkedTaskId).filter((id): id is number => id != null)),
    ];
    const exhaustedHeadByTask = new Map<number, string | null>();
    if (linkedTaskIds.length > 0) {
      try {
        const transitions = await prisma.workflowTransition.findMany({
          where: { taskId: { in: linkedTaskIds }, cause: EXHAUSTED_CAUSE },
          orderBy: { createdAt: 'desc' },
          select: { taskId: true, metadata: true },
        });
        for (const t of transitions) {
          if (!exhaustedHeadByTask.has(t.taskId)) {
            exhaustedHeadByTask.set(t.taskId, parseStoredHeadSha(t.metadata));
          }
        }
      } catch (err) {
        log.warn(
          { err, themeId },
          '[pr-files] exhausted-transition lookup failed — excluding none',
        );
      }
    }

    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
      select: { workingDirectory: true },
    });
    const cwd = theme?.workingDirectory;
    if (!cwd) return rows;
    const snapshots = await Promise.all(rows.map((row) => getPrSnapshot(cwd, row.prNumber, deps)));
    // DB synchronization is bounded and can miss old closed/merged PRs.
    // Unknown remote state retains the DB candidate; only confirmed terminal
    // PRs stop contributing to both merge barriers and scope-overlap holds.
    return rows.filter((row, index) => {
      const snap = snapshots[index];
      if (['CLOSED', 'MERGED'].includes(snap.state ?? '')) return false;
      const storedHead =
        row.linkedTaskId != null ? exhaustedHeadByTask.get(row.linkedTaskId) : undefined;
      if (storedHead != null && storedHead === snap.headSha) return false;
      return true;
    });
  } catch (err) {
    log.warn({ err, themeId }, '[pr-files] open auto-PR lookup failed — treating as none');
    return [];
  }
}

/**
 * Changed files of one nonterminal PR via `gh pr view <n> --json files,state`, memoized for
 * {@link PR_FILES_CACHE_TTL_MS}. gh errors resolve to [] (fail-open) and are
 * cached for the same TTL to bound retry rate.
 *
 * @param cwd - Repo working directory for gh / gh実行ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param deps - Injectable exec/clock (tests) / テスト用注入
 * @returns Repo-relative changed file paths / 変更ファイルパス一覧
 */
export async function getPrChangedFiles(
  cwd: string,
  prNumber: number,
  deps: PrFilesDeps = defaultDeps,
): Promise<string[]> {
  const snapshot = await getPrSnapshot(cwd, prNumber, deps);
  return ['CLOSED', 'MERGED'].includes(snapshot.state ?? '') ? [] : snapshot.files;
}

async function getPrSnapshot(
  cwd: string,
  prNumber: number,
  deps: PrFilesDeps,
): Promise<CacheEntry> {
  const now = deps.now();
  const key = JSON.stringify([cwd, prNumber]);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit;

  let files: string[] = [];
  let state: string | null = null;
  let headSha: string | null = null;
  try {
    const stdout = await deps.execGh(
      `${ghPath()} pr view ${prNumber} --json files,state,headRefOid`,
      cwd,
    );
    const parsed = JSON.parse(stdout) as {
      files?: Array<{ path?: string }>;
      state?: string;
      headRefOid?: string;
    };
    state = typeof parsed.state === 'string' ? parsed.state.toUpperCase() : null;
    files = (parsed.files ?? []).map((f) => (f.path ?? '').trim()).filter((p) => p.length > 0);
    headSha = typeof parsed.headRefOid === 'string' ? parsed.headRefOid : null;
  } catch (err) {
    log.warn({ err, prNumber }, '[pr-files] gh pr view --json files failed — treating as empty');
  }
  const entry = { files, state, headSha, expiresAt: now + PR_FILES_CACHE_TTL_MS };
  cache.set(key, entry);
  return entry;
}
