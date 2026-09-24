/**
 * continue-execution-pr-link テスト
 *
 * linkContinueExecutionPr: continue-execution経路でエージェントが直接
 * `gh pr create` したPRを検出し、タスク識別マーカーを検証した上で
 * linkAutoCreatedPr を呼ぶことを検証する（task #1058）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/database', () => ({ prisma: {} }));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

let runGhCommandMock: ReturnType<typeof mock>;
mock.module('./gh-client', () => ({
  runGhCommand: (...args: unknown[]) => runGhCommandMock(...args),
}));

let linkAutoCreatedPrMock: ReturnType<typeof mock>;
mock.module('./pr-link', () => ({
  linkAutoCreatedPr: (...args: unknown[]) => linkAutoCreatedPrMock(...args),
}));

const { linkContinueExecutionPr } = await import('./continue-execution-pr-link');

function makePrisma(githubPrId: number | null = null) {
  return {
    task: {
      findUnique: mock(() => Promise.resolve({ githubPrId })),
    },
  } as any;
}

describe('linkContinueExecutionPr', () => {
  beforeEach(() => {
    runGhCommandMock = mock(() =>
      Promise.resolve(
        JSON.stringify({
          number: 42,
          url: 'https://github.com/takamurayuki/rapitas/pull/42',
          baseRefName: 'develop',
          title: '[#1058] fix pr linking',
        }),
      ),
    );
    linkAutoCreatedPrMock = mock(() => Promise.resolve(1));
  });

  test('PRが見つかりタイトルマーカーがtaskIdと一致する場合、linkAutoCreatedPrを呼ぶ', async () => {
    const prisma = makePrisma();
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' });

    expect(runGhCommandMock).toHaveBeenCalledTimes(1);
    expect(linkAutoCreatedPrMock).toHaveBeenCalledTimes(1);
    const arg = linkAutoCreatedPrMock.mock.calls[0][1] as {
      taskId: number;
      prNumber: number;
      headBranch: string;
    };
    expect(arg.taskId).toBe(1058);
    expect(arg.prNumber).toBe(42);
    expect(arg.headBranch).toBe('feature/1058');
  });

  test('PRが見つかったがタイトルマーカーが別のtaskIdを指す場合、linkAutoCreatedPrを呼ばない', async () => {
    runGhCommandMock = mock(() =>
      Promise.resolve(
        JSON.stringify({
          number: 7,
          url: 'https://github.com/takamurayuki/rapitas/pull/7',
          baseRefName: 'develop',
          title: '[#999] other task pr',
        }),
      ),
    );
    const prisma = makePrisma();
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' });

    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  test('PRが見つかったがタイトルにマーカーが一切ない場合、linkAutoCreatedPrを呼ばない', async () => {
    runGhCommandMock = mock(() =>
      Promise.resolve(
        JSON.stringify({
          number: 7,
          url: 'https://github.com/takamurayuki/rapitas/pull/7',
          baseRefName: 'develop',
          title: 'no marker here',
        }),
      ),
    );
    const prisma = makePrisma();
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' });

    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  test('該当ブランチにopen PRがない場合（null応答）、linkAutoCreatedPrを呼ばない', async () => {
    runGhCommandMock = mock(() => Promise.resolve('null'));
    const prisma = makePrisma();
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' });

    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  test('Task.githubPrIdが既に設定済みの場合、ghコマンド自体を呼ばない', async () => {
    const prisma = makePrisma(99);
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' });

    expect(runGhCommandMock).not.toHaveBeenCalled();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  test('branchNameがnullの場合、ghコマンドを呼ばない', async () => {
    const prisma = makePrisma();
    await linkContinueExecutionPr(prisma, { taskId: 1058, branchName: null, cwd: '/wt' });

    expect(runGhCommandMock).not.toHaveBeenCalled();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });

  test('ghコマンドが例外をスローしても呼び出し元に伝播しない', async () => {
    runGhCommandMock = mock(() => Promise.reject(new Error('gh timeout')));
    const prisma = makePrisma();

    await expect(
      linkContinueExecutionPr(prisma, { taskId: 1058, branchName: 'feature/1058', cwd: '/wt' }),
    ).resolves.toBeUndefined();
    expect(linkAutoCreatedPrMock).not.toHaveBeenCalled();
  });
});
