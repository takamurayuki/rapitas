/**
 * detection-miss-ledger.test
 *
 * Pure-extraction tests (acceptance 1): ci_repair transitions and
 * post-completion concerns become evidence-backed cases; verify_repair
 * (incl. diff_review), honest failures, in-progress concerns and automated
 * process sources must NOT fire (the no-false-positive normal cases).
 * recordMissCases: dedup swallow + fail-open.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const missCaseCreateMock = mock((_args: unknown) => Promise.resolve({ id: 1 }));
const transitionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const knowledgeFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const taskFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    detectionMissCase: { create: missCaseCreateMock },
    workflowTransition: { findMany: transitionFindManyMock },
    knowledgeEntry: { findMany: knowledgeFindManyMock },
    task: { findMany: taskFindManyMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { extractMissCases, recordMissCases, collectAndRecordMissCases } =
  await import('./detection-miss-ledger');

const T0 = Date.parse('2026-08-01T00:00:00.000Z');

function ciRepairRow(over: Record<string, unknown> = {}) {
  return {
    id: 900,
    taskId: 578,
    cause: 'ci_repair',
    metadata: JSON.stringify({
      attempt: 1,
      max: 2,
      failedChecks: ['Test Backend', 'Lint Code'],
      headSha: 'abc1234',
    }),
    createdAt: new Date(T0),
    ...over,
  };
}

const EMPTY = { transitions: [], concerns: [], tasksById: new Map() };

describe('extractMissCases — ci_repair (acceptance 1)', () => {
  test('ci_repair 遷移が taskId・時刻・遷移行IDの証拠つき事例になる', () => {
    const cases = extractMissCases({ ...EMPTY, transitions: [ciRepairRow()] });

    expect(cases).toHaveLength(1);
    const c = cases[0]!;
    expect(c.taskId).toBe(578);
    expect(c.gate).toBe('ci_repair');
    expect(c.dedupKey).toBe('miss:ci_repair:578:900');
    expect(c.detectedAt.getTime()).toBe(T0);
    expect(c.reason).toContain('Test Backend');
    const evidence = JSON.parse(c.evidenceJson) as Record<string, unknown>;
    expect(evidence.transitionId).toBe(900);
    expect(evidence.occurredAt).toBe(new Date(T0).toISOString());
    expect(evidence.failedChecks).toEqual(['Test Backend', 'Lint Code']);
    expect(evidence.headSha).toBe('abc1234');
    // Log lines are not in the transition metadata — recorded honestly, not fabricated.
    expect(evidence.logRef).toBe('unavailable');
  });

  test('metadata が壊れていても事例化する（証拠は取得できた範囲のみ）', () => {
    const cases = extractMissCases({
      ...EMPTY,
      transitions: [ciRepairRow({ metadata: '{broken json' })],
    });
    expect(cases).toHaveLength(1);
    const evidence = JSON.parse(cases[0]!.evidenceJson) as Record<string, unknown>;
    expect(evidence.failedChecks).toEqual([]);
    expect(evidence.logRef).toBe('unavailable');
  });
});

describe('extractMissCases — 発火しない正常系（精度優先）', () => {
  test('verify_repair(diff_review) は完了前にゲートが捕捉した正常動作 — 事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      transitions: [
        ciRepairRow({
          cause: 'verify_repair',
          metadata: JSON.stringify({ reason: '差分レビュー不合格: 実装が不完全' }),
        }),
      ],
    });
    expect(cases).toEqual([]);
  });

  test('honest_failure 系の verify_repair も事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      transitions: [
        ciRepairRow({
          cause: 'verify_repair',
          metadata: JSON.stringify({ reason: 'verify.md explicitly marks failing tests' }),
        }),
      ],
    });
    expect(cases).toEqual([]);
  });

  test('無関係な cause (auto_advance 等) は事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      transitions: [ciRepairRow({ cause: 'auto_advance' }), ciRepairRow({ cause: null, id: 901 })],
    });
    expect(cases).toEqual([]);
  });
});

function concernRow(over: Record<string, unknown> = {}) {
  return {
    id: 7000,
    originTaskId: 500,
    title: '完了済みタスクの実装にnullガード漏れ',
    source: 'user',
    createdAt: new Date(T0 + 60 * 60 * 1000), // completion + 1h
    ...over,
  };
}

function completedTask(over: Record<string, unknown> = {}) {
  return { id: 500, status: 'completed', completedAt: new Date(T0), ...over };
}

describe('extractMissCases — post_completion_concern', () => {
  test('完了後に人間が起票した懸念が証拠つき事例になる（受入基準1）', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [concernRow()],
      tasksById: new Map([[500, completedTask()]]),
    });

    expect(cases).toHaveLength(1);
    const c = cases[0]!;
    expect(c.gate).toBe('post_completion_concern');
    expect(c.taskId).toBe(500);
    expect(c.dedupKey).toBe('miss:post_completion_concern:500:7000');
    const evidence = JSON.parse(c.evidenceJson) as Record<string, unknown>;
    expect(evidence.concernId).toBe(7000);
    expect(evidence.taskCompletedAt).toBe(new Date(T0).toISOString());
    expect(evidence.source).toBe('user');
  });

  test('実行中タスクへの懸念は素通しではない — 事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [concernRow()],
      tasksById: new Map([[500, completedTask({ status: 'in-progress', completedAt: null })]]),
    });
    expect(cases).toEqual([]);
  });

  test('completedAt が起票より後（完了前の起票）は事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [concernRow()],
      tasksById: new Map([
        [500, completedTask({ completedAt: new Date(T0 + 2 * 60 * 60 * 1000) })],
      ]),
    });
    expect(cases).toEqual([]);
  });

  test('completedAt 不明は完了後証明ができない — 事例化しない（捏造しない）', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [concernRow()],
      tasksById: new Map([[500, completedTask({ completedAt: null })]]),
    });
    expect(cases).toEqual([]);
  });

  test('自動プロセスレビュー由来（process_retro 等）は事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [
        concernRow({ source: 'process_retro' }),
        concernRow({ id: 7001, source: 'self_incident_watch' }),
      ],
      tasksById: new Map([[500, completedTask()]]),
    });
    expect(cases).toEqual([]);
  });

  test('originTaskId の無い懸念・タスク行が引けない懸念は事例化しない', () => {
    const cases = extractMissCases({
      ...EMPTY,
      concerns: [concernRow({ originTaskId: null }), concernRow({ id: 7002, originTaskId: 999 })],
      tasksById: new Map([[500, completedTask()]]),
    });
    expect(cases).toEqual([]);
  });
});

describe('recordMissCases', () => {
  beforeEach(() => {
    missCaseCreateMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('新規事例を作成し件数を返す', async () => {
    const candidates = extractMissCases({ ...EMPTY, transitions: [ciRepairRow()] });
    const created = await recordMissCases(candidates);
    expect(created).toBe(1);
    expect(missCaseCreateMock).toHaveBeenCalledTimes(1);
  });

  test('dedupKey 重複 (P2002) は握り潰して継続する', async () => {
    missCaseCreateMock.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('unique'), { code: 'P2002' })),
    );
    const candidates = extractMissCases({
      ...EMPTY,
      transitions: [ciRepairRow(), ciRepairRow({ id: 901 })],
    });
    const created = await recordMissCases(candidates);
    expect(created).toBe(1);
  });

  test('その他のDBエラーも fail-open で継続する', async () => {
    missCaseCreateMock.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const candidates = extractMissCases({
      ...EMPTY,
      transitions: [ciRepairRow(), ciRepairRow({ id: 901 })],
    });
    const created = await recordMissCases(candidates);
    expect(created).toBe(1);
  });
});

describe('collectAndRecordMissCases', () => {
  beforeEach(() => {
    missCaseCreateMock.mockReset().mockResolvedValue({ id: 1 });
    transitionFindManyMock.mockReset().mockResolvedValue([]);
    knowledgeFindManyMock.mockReset().mockResolvedValue([]);
    taskFindManyMock.mockReset().mockResolvedValue([]);
  });

  test('DB行を集めて抽出・記録する（source は tags から解析）', async () => {
    transitionFindManyMock.mockResolvedValue([ciRepairRow()]);
    knowledgeFindManyMock.mockResolvedValue([
      {
        id: 7000,
        taskId: 500,
        title: '完了後に見つかった欠陥',
        tags: JSON.stringify(['severity:high', 'source:user']),
        createdAt: new Date(T0 + 60 * 60 * 1000),
      },
    ]);
    taskFindManyMock.mockResolvedValue([completedTask()]);

    const created = await collectAndRecordMissCases({ nowMs: T0 + 2 * 60 * 60 * 1000 });

    expect(created).toBe(2);
    expect(missCaseCreateMock).toHaveBeenCalledTimes(2);
  });

  test('クエリ失敗は fail-open で 0 を返す', async () => {
    transitionFindManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    knowledgeFindManyMock.mockImplementation(() => Promise.reject(new Error('db down')));
    const created = await collectAndRecordMissCases({ nowMs: T0 });
    expect(created).toBe(0);
  });
});
