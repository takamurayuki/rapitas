/**
 * CI Green Keeper
 *
 * Watches the MAINLINE branch's CI (per theme working directory) and files a
 * concern for every workflow whose latest completed run is red — with the
 * failing job/step names so the ensuing repair task starts from evidence.
 * PR branches already have a repair loop (ci_repair / AutoMergeWatcher);
 * this closes the gap for pushes that land on the base branch itself, where
 * red CI previously had NO watcher and rotted for weeks. Dedup-keyed per
 * theme+workflow so a persisting red never piles up duplicates.
 * Not responsible for fixing anything — the concern→task pipeline is the
 * repair path. Scheduling lives in backlog-scheduler.ts (kind 'ci_watch').
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { submitConcern } from '../memory/concern-backlog-service';
import { getDisabledThemeIds } from '../scheduling/theme-backlog-override-service';

const execAsync = promisify(exec);
const log = createLogger('self-improvement:ci-green-keeper');

/** Max themes checked per run — bounds gh API cost. */
const MAX_THEMES = 5;
/** Recent runs fetched per repo (enough to cover every workflow's latest). */
const RUNS_FETCHED = 20;

function ghPath(): string {
  return process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
}

/** One workflow run as returned by `gh run list`. */
export interface CiRun {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
}

/**
 * Pick each workflow's LATEST completed run from a newest-first run list and
 * return the failing ones. Pure — the testable core.
 *
 * @param runs - Runs, newest first (gh run list order). / 新しい順のrun一覧
 * @returns Failing latest-per-workflow runs. / ワークフロー毎の最新失敗run
 */
export function pickFailingWorkflows(runs: CiRun[]): CiRun[] {
  const seen = new Set<string>();
  const failing: CiRun[] = [];
  for (const run of runs) {
    if (run.status !== 'completed') continue; // in-progress → judge next time
    if (seen.has(run.workflowName)) continue; // only the newest per workflow
    seen.add(run.workflowName);
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') failing.push(run);
  }
  return failing;
}

/** Fetch recent runs for a repo's branch, or null when gh/repo is unusable. */
async function listRecentRuns(cwd: string, branch: string): Promise<CiRun[] | null> {
  try {
    const { stdout } = await execAsync(
      `${ghPath()} run list --branch ${branch} --limit ${RUNS_FETCHED} --json databaseId,workflowName,status,conclusion`,
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as CiRun[]) : null;
  } catch (err) {
    // No gh / no remote / no Actions — this repo simply isn't watchable.
    log.debug({ err, cwd, branch }, '[ci-green-keeper] run list unavailable');
    return null;
  }
}

/** Summarize a failed run's failing jobs+steps for the concern body. */
async function describeFailure(cwd: string, runId: number): Promise<string> {
  try {
    const { stdout } = await execAsync(`${ghPath()} run view ${runId} --json jobs,url`, {
      cwd,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const data = JSON.parse(stdout) as {
      url?: string;
      jobs?: Array<{
        name?: string;
        conclusion?: string;
        steps?: Array<{ name?: string; conclusion?: string }>;
      }>;
    };
    const lines: string[] = [];
    for (const job of data.jobs ?? []) {
      if (job.conclusion !== 'failure') continue;
      const steps = (job.steps ?? [])
        .filter((s) => s.conclusion === 'failure')
        .map((s) => s.name)
        .filter(Boolean)
        .join(' / ');
      lines.push(`- ジョブ「${job.name}」${steps ? ` — 失敗ステップ: ${steps}` : ''}`);
    }
    if (data.url) lines.push(`\n実行ログ: ${data.url}`);
    return lines.join('\n') || '(失敗ジョブの詳細を取得できませんでした)';
  } catch {
    return '(失敗ジョブの詳細を取得できませんでした)';
  }
}

/**
 * Run one CI watch pass across themes with a working directory.
 *
 * @returns Number of concerns filed. / 起票件数
 */
export async function runCiWatch(): Promise<number> {
  const disabled = await getDisabledThemeIds('ci_watch').catch(() => new Set<number>());
  const themes = await prisma.theme.findMany({
    where: {
      workingDirectory: { not: null },
      ...(disabled.size > 0 ? { id: { notIn: [...disabled] } } : {}),
    },
    select: { id: true, name: true, workingDirectory: true, defaultBranch: true },
    take: MAX_THEMES,
  });

  let filed = 0;
  for (const theme of themes) {
    const dir = theme.workingDirectory;
    if (!dir || !existsSync(join(dir, '.git'))) continue;
    const branch = theme.defaultBranch?.trim() || 'develop';

    const runs = await listRecentRuns(dir, branch);
    if (!runs) continue;
    const failing = pickFailingWorkflows(runs);

    for (const run of failing) {
      const detail = await describeFailure(dir, run.databaseId);
      try {
        await submitConcern({
          title: `[CI赤] ${theme.name}/${branch}: ${run.workflowName} が失敗しています`,
          detail:
            `本線ブランチ \`${branch}\` の最新の「${run.workflowName}」実行が失敗しています。` +
            `CI が赤のままだと全ての品質信号が死ぬため、緑に戻すことを最優先で対応してください。\n\n` +
            `失敗内容:\n${detail}\n\n` +
            `対応の型: 失敗ステップをローカルで再現 → 修正 → 同一チェックをローカルで緑化 → push で CI 再実行を確認。`,
          type: 'bug',
          severity: 'high',
          themeId: theme.id,
          source: 'ci_watch',
          // Stable per theme+workflow: a red that persists across runs updates
          // the open concern instead of stacking new ones.
          dedupKey: `ci-red:${theme.id}:${run.workflowName}`,
        });
        filed++;
      } catch (err) {
        log.warn({ err, themeId: theme.id, workflow: run.workflowName }, 'concern filing failed');
      }
    }
    if (failing.length === 0) {
      log.info({ themeId: theme.id, branch }, '[ci-green-keeper] all workflows green');
    }
  }

  log.info({ filed, themes: themes.length }, '[ci-green-keeper] CI watch complete');
  return filed;
}
