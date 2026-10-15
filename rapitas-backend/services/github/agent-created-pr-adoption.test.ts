/**
 * agent-created-pr-adoption.test
 *
 * task 1105(2026-09-27): エージェント自身が `gh pr create` した PR はローカルに
 * 行も link も残らないため、taskHasLinkedPr は「PR なし」を返し、エージェント側の
 * `gh pr list --head <branch>`(既定 --state open)も auto-merge 済みでは空を返す。
 * 結果、着地済みの成果に対して verify が「PR 未作成」と正直に報告し差し戻しが
 * 繰り返された。タイトルマーカー一致で任意の state から拾い、既に他タスクに
 * 紐付いた PR は決して奪わないことを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

let ghStdout = '[]';
let ghThrows = false;
const execFileMock = mock(
  (
    _file: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, res: { stdout: string; stderr: string }) => void,
  ) => {
    if (ghThrows) cb(new Error('gh not found'), { stdout: '', stderr: '' });
    else cb(null, { stdout: ghStdout, stderr: '' });
  },
);

mock.module('node:child_process', () => ({ execFile: execFileMock }));

const taskUpdateMock = mock(() => Promise.resolve({}));
const taskFindFirstMock = mock(() => Promise.resolve<{ id: number } | null>(null));

mock.module('../../config/database', () => ({
  prisma: { task: { update: taskUpdateMock, findFirst: taskFindFirstMock } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../agents/orchestrator/git-operations/pr/gh-cli-path', () => ({
  ghPath: () => 'gh',
}));

const { discoverAgentCreatedPr, adoptAgentCreatedPr } = await import('./agent-created-pr-adoption');

function prList(prs: { number: number; title: string; state: string }[]): string {
  return JSON.stringify(prs.map((p) => ({ ...p, url: `https://example.test/pr/${p.number}` })));
}

beforeEach(() => {
  ghStdout = '[]';
  ghThrows = false;
  execFileMock.mockClear();
  taskUpdateMock.mockClear().mockResolvedValue({});
  taskFindFirstMock.mockClear().mockResolvedValue(null);
});

describe('discoverAgentCreatedPr', () => {
  test('finds a MERGED PR by its title marker — the case the open-only check misses', async () => {
    ghStdout = prList([{ number: 826, title: '[#1105] today-todo の再実装', state: 'MERGED' }]);
    expect(await discoverAgentCreatedPr(1105)).toMatchObject({ number: 826, state: 'MERGED' });
  });

  test('queries every state, not just open', async () => {
    await discoverAgentCreatedPr(1105);
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain('--state');
    expect(args[args.indexOf('--state') + 1]).toBe('all');
  });

  test('accepts the [Task-id] marker form too', async () => {
    ghStdout = prList([{ number: 830, title: '[Task-1105] fix', state: 'OPEN' }]);
    expect(await discoverAgentCreatedPr(1105)).toMatchObject({ number: 830 });
  });

  test('does not match another task whose id shares a prefix', async () => {
    ghStdout = prList([{ number: 900, title: '[#110] other task', state: 'OPEN' }]);
    expect(await discoverAgentCreatedPr(1105)).toBeNull();
  });

  test('ignores a PR with no task marker', async () => {
    ghStdout = prList([{ number: 901, title: 'chore: bump deps', state: 'OPEN' }]);
    expect(await discoverAgentCreatedPr(1105)).toBeNull();
  });

  test('prefers an open PR over a merged one', async () => {
    ghStdout = prList([
      { number: 826, title: '[#1105] first', state: 'MERGED' },
      { number: 827, title: '[#1105] second', state: 'OPEN' },
    ]);
    expect(await discoverAgentCreatedPr(1105)).toMatchObject({ number: 827 });
  });

  test('returns null when gh fails or returns junk', async () => {
    ghThrows = true;
    expect(await discoverAgentCreatedPr(1105)).toBeNull();
    ghThrows = false;
    ghStdout = 'not json';
    expect(await discoverAgentCreatedPr(1105)).toBeNull();
  });
});

describe('adoptAgentCreatedPr', () => {
  test('records the PR number on the task', async () => {
    ghStdout = prList([{ number: 826, title: '[#1105] today-todo', state: 'MERGED' }]);
    expect(await adoptAgentCreatedPr(1105)).toBe(true);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 1105 },
      data: { githubPrId: 826 },
    });
  });

  test('refuses a PR number another task already claims', async () => {
    ghStdout = prList([{ number: 826, title: '[#1105] today-todo', state: 'MERGED' }]);
    taskFindFirstMock.mockResolvedValue({ id: 999 });
    expect(await adoptAgentCreatedPr(1105)).toBe(false);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });

  test('asks the ownership question without an unscoped prNumber lookup', async () => {
    ghStdout = prList([{ number: 826, title: '[#1105] today-todo', state: 'MERGED' }]);
    await adoptAgentCreatedPr(1105);
    expect(taskFindFirstMock.mock.calls[0][0]).toEqual({
      where: { githubPrId: 826, id: { not: 1105 } },
      select: { id: true },
    });
  });

  test('reports false when no PR matches', async () => {
    ghStdout = '[]';
    expect(await adoptAgentCreatedPr(1105)).toBe(false);
    expect(taskUpdateMock).not.toHaveBeenCalled();
  });
});
