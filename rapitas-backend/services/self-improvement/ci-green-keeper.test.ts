/**
 * ci-green-keeper.test
 *
 * Unit tests for the pure latest-per-workflow failure picker. The gh-CLI /
 * prisma shell (runCiWatch) is exercised operationally via the backlog job.
 */
import { afterAll, beforeEach, describe, it, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

// Real SQLite so submitConcern's dedup (findBlockingDuplicate) runs for real.
const dir = mkdtempSync(join(tmpdir(), 'rapitas-ci-watch-'));
const dbPath = join(dir, 'test.db');
const initializer = new Database(dbPath);
initializer.exec(SQLITE_INIT_SQL);
initializer.close();
const db = new PrismaClient({
  datasources: { db: { url: `file:${dbPath.replaceAll('\\', '/')}` } },
});
const createLogger = () => ({ info() {}, warn() {}, error() {}, debug() {} });
mock.module('../../config', () => ({ prisma: db, createLogger }));
mock.module('../../config/database', () => ({
  prisma: db,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({ createLogger }));

const { pickFailingWorkflows, runCiWatchWith } = await import('./ci-green-keeper');
type CiRun = import('./ci-green-keeper').CiRun;
type CiWatchDeps = import('./ci-green-keeper').CiWatchDeps;
const { submitConcern } = await import('../memory/concern-backlog-service');
const { jobDedupKey } = await import('./ci-green-keeper-jobs');

function run(over: Partial<CiRun>): CiRun {
  return {
    databaseId: 1,
    workflowName: 'Test and Lint',
    status: 'completed',
    conclusion: 'success',
    ...over,
  };
}

describe('pickFailingWorkflows', () => {
  it('returns the newest completed run per workflow when it failed', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, conclusion: 'failure' }),
      run({ databaseId: 9, conclusion: 'success' }), // older run of same workflow
      run({ databaseId: 8, workflowName: 'Build Tauri App', conclusion: 'success' }),
    ]);
    expect(failing.map((r) => r.databaseId)).toEqual([10]);
  });

  it('ignores a red run that a newer green run has superseded', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, conclusion: 'success' }),
      run({ databaseId: 9, conclusion: 'failure' }),
    ]);
    expect(failing).toEqual([]);
  });

  it('skips in-progress runs and judges the previous completed one', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 11, status: 'in_progress', conclusion: null }),
      run({ databaseId: 10, conclusion: 'failure' }),
    ]);
    expect(failing.map((r) => r.databaseId)).toEqual([10]);
  });

  it('counts timed_out as failing and ignores cancelled', () => {
    const failing = pickFailingWorkflows([
      run({ databaseId: 10, workflowName: 'A', conclusion: 'timed_out' }),
      run({ databaseId: 9, workflowName: 'B', conclusion: 'cancelled' }),
    ]);
    expect(failing.map((r) => r.workflowName)).toEqual(['A']);
  });
});

describe('runCiWatchWith (real SQLite + real submitConcern)', () => {
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  const realLog = readFileSync(
    join(import.meta.dir, '__fixtures__/gh-run-view-log-failed.txt'),
    'utf8',
  );
  let themeId = 0;

  beforeEach(async () => {
    await db.knowledgeEntry.deleteMany({});
    await db.task.deleteMany({});
    await db.theme.deleteMany({});
    const t = await db.theme.create({
      data: { name: 'T', workingDirectory: repo, defaultBranch: 'develop' },
    });
    themeId = t.id;
  });
  afterAll(async () => {
    await db.$disconnect(); // Windows keeps the SQLite file locked until disconnect
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best-effort
    }
  });

  function deps(over: Partial<CiWatchDeps> & { runs?: CiRun[]; jobs?: string }): CiWatchDeps & {
    views: number;
    logs: number;
  } {
    const state = { views: 0, logs: 0 };
    return Object.assign(state, {
      listRuns: async () => over.runs ?? [run({ databaseId: 5 })],
      viewJobs: async () => {
        state.views++;
        return {
          url: 'https://example.test/run/5',
          jobs: [
            { name: 'Backend', conclusion: 'success' },
            {
              name: over.jobs ?? 'Full Suite (Advisory)',
              conclusion: 'failure',
              steps: [{ name: 'Run full test suite (parallel, advisory)', conclusion: 'failure' }],
            },
          ],
        };
      },
      logFailed: async () => {
        state.logs++;
        return realLog;
      },
    });
  }

  async function concerns() {
    return db.knowledgeEntry.findMany({ where: { sourceType: 'concern' } });
  }

  it('files ONE concern for a green workflow whose advisory job is red, with real failing test names', async () => {
    const d = deps({});
    expect(await runCiWatchWith(d)).toBe(1);
    const rows = await concerns();
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows[0]);
    expect(text).toContain('Full Suite (Advisory)');
    expect(text).toContain('Run full test suite (parallel, advisory)');
    expect(text).toContain('ケース2 食い違い');
  });

  it('keeps one concern when the same job stays red (real submitConcern reuses it)', async () => {
    const d = deps({});
    await runCiWatchWith(d);
    await runCiWatchWith(deps({ runs: [run({ databaseId: 6 })] })); // newer run, same red job
    expect(await concerns()).toHaveLength(1);

    const key = `ci-red:${themeId}:Test and Lint:Full Suite (Advisory)`;
    const again = await submitConcern({
      title: 'x',
      detail: 'y',
      type: 'bug',
      severity: 'high',
      themeId,
      source: 'ci_watch',
      dedupKey: key,
    });
    expect(again.outcome).toBe('reused');
  });

  it('files nothing for an excluded job', async () => {
    const d = deps({ jobs: 'Security / zizmor' });
    expect(await runCiWatchWith(d)).toBe(0);
    expect(await concerns()).toHaveLength(0);
  });

  it.each(['open', 'task_created'])('%sの実submitConcernの2回目がreusedとなる', async (state) => {
    const input = {
      title: 'advisoryジョブの継続失敗',
      detail: 'Full Suite (Advisory) が失敗',
      type: 'bug' as const,
      severity: 'high' as const,
      themeId,
      source: 'ci_watch',
      dedupKey: jobDedupKey(themeId, 'Test and Lint', 'Full Suite (Advisory)'),
    };
    const first = await submitConcern(input);
    if (state === 'task_created') {
      const task = await db.task.create({
        data: { title: 'CI修復', status: 'in_progress', themeId },
      });
      await db.knowledgeEntry.update({
        where: { id: first.id },
        data: { sourceId: `task_${task.id}` },
      });
    }
    const second = await submitConcern(input);
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('reused');
    expect(second.id).toBe(first.id);
    expect(await concerns()).toHaveLength(1);
  });

  it.each(['failure', 'timed_out'])(
    '%sのrunで通常ジョブのタイムアウト通知を保持する',
    async (conclusion) => {
      const d = deps({ runs: [run({ conclusion })] });
      d.viewJobs = async () => ({
        jobs: [
          {
            name: 'Backend',
            conclusion: 'timed_out',
            steps: [{ name: '通常テスト', conclusion: 'timed_out' }],
          },
          { name: 'Full Suite (Advisory)', conclusion: 'failure' },
        ],
      });
      expect(await runCiWatchWith(d)).toBe(2);
      const rows = await concerns();
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).toContain('Backend');
      expect(JSON.stringify(rows)).toContain('通常テスト');
      expect(d.logs).toBe(1);
    },
  );

  it('does not read jobs for a green workflow without advisory jobs', async () => {
    const d = deps({ runs: [run({ databaseId: 7, workflowName: 'Build Tauri App' })] });
    expect(await runCiWatchWith(d)).toBe(0);
    expect(d.views).toBe(0);
  });

  it.each([{ runs: null }, { runs: [] }])(
    'run一覧が%jならジョブもログも取得しない',
    async ({ runs }) => {
      const d = deps({});
      d.listRuns = async () => runs;
      expect(await runCiWatchWith(d)).toBe(0);
      expect(await concerns()).toHaveLength(0);
      expect(d.views).toBe(0);
      expect(d.logs).toBe(0);
    },
  );

  it('still files when --log-failed is unavailable', async () => {
    const d = { ...deps({}), logFailed: async () => null };
    expect(await runCiWatchWith(d)).toBe(1);
    expect(JSON.stringify((await concerns())[0])).toContain('失敗ログを取得できませんでした');
  });

  it('ログ取得が例外を投げても起票を続ける', async () => {
    const d = {
      ...deps({}),
      logFailed: async () => {
        throw new Error('ログ取得エラー');
      },
    };
    expect(await runCiWatchWith(d)).toBe(1);
    expect(JSON.stringify((await concerns())[0])).toContain('失敗ログを取得できませんでした');
  });

  it('取得済みの空ログでは取得失敗ではなく抽出0件を伝える', async () => {
    const d = { ...deps({}), logFailed: async () => '' };
    expect(await runCiWatchWith(d)).toBe(1);
    const text = JSON.stringify((await concerns())[0]);
    expect(text).toContain('失敗テスト名を抽出できませんでした');
    expect(text).not.toContain('失敗ログを取得できませんでした');
  });

  it('does not double-file when a failed workflow run only has an advisory job red', async () => {
    const d = deps({ runs: [run({ databaseId: 8, conclusion: 'failure' })] });
    expect(await runCiWatchWith(d)).toBe(1); // job-level only, no workflow-level twin
    expect(await concerns()).toHaveLength(1);
  });

  it('advisoryジョブのタイムアウトは従来のworkflowキーで通知する', async () => {
    const d = deps({ runs: [run({ conclusion: 'timed_out' })] });
    d.viewJobs = async () => ({
      jobs: [{ name: 'Full Suite (Advisory)', conclusion: 'timed_out' }],
    });
    expect(await runCiWatchWith(d)).toBe(1);
    const rows = await concerns();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('[CI赤] T/develop: Test and Lint が失敗しています');
    expect(rows[0].content).toContain('Full Suite (Advisory)');
    expect(d.logs).toBe(0);
  });
});
