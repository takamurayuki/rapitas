/**
 * verify-claim-loader.test
 *
 * 実際のストアとローダーを通し、主張したタスク・runId の実測だけで判定する。
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

interface StoredEvent {
  id: number;
  eventType: string;
  correlationId?: string;
  payload: string;
  createdAt: Date;
}

let events: StoredEvent[] = [];
const findMany = mock(
  async (query: { where: Record<string, unknown>; take: number; skip: number }) =>
    events
      .filter(
        (event) => !query.where.correlationId || event.correlationId === query.where.correlationId,
      )
      .slice()
      .reverse()
      .slice(query.skip, query.skip + query.take),
);

// DB 境界だけを置換し、イベントの保存・復元と taskId/runId の選別は実コードを使う。
mock.module('../../config/database', () => ({
  prisma: {
    timelineEvent: {
      create: async ({ data }: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
        const event = { ...data, id: events.length + 1, createdAt: new Date() };
        events.push(event);
        return event;
      },
      findMany,
      count: async ({ where }: { where: Record<string, unknown> }) =>
        events.filter(
          (event) => !where.correlationId || event.correlationId === where.correlationId,
        ).length,
    },
  },
}));

const { loadMeasuredVerification } = await import('./verify-claim-loader');
const { recordJobStart, recordJobFinish } = await import('./verification-job-store');
const { validateVerify } = await import('./phase-output-validator');

const SHA = 'a1b2c3d4';

const withClaim = (runId: string) =>
  '```json:verify-claim\n' +
  JSON.stringify({
    version: 1,
    overall: 'success',
    runId,
    sha: SHA,
    tests: { ran: true, failed: 0 },
  }) +
  '\n```';

const report = (runId: string) => `# 検証レポート
## 検証結果サマリ
検証成功。全テスト通過。
## 変更ファイル
| ファイル | 種別 | 内容 |
| --- | --- | --- |
| a.ts | 変更 | 検査を修正 |
## テスト結果
修正を外すと9件失敗。初回は exit 1。環境に拒否され別経路で実行。
${withClaim(runId)}
## チェックリスト
- 実装済み
## 未解決の懸念
なし
`;

async function storeJob(taskId: number, runId: string, ok = true, revision = SHA) {
  await recordJobStart(taskId, runId, 'fingerprint', {
    operation: `POST /workflow/tasks/${taskId}/run-verification`,
    worktreePath: '/test/worktree',
    revision,
  });
  await recordJobFinish(taskId, runId, {
    status: 'completed',
    ok,
    unverifiable: false,
    checks: [{ name: 'test', ran: true, ok, errorCount: ok ? 0 : 1, details: '' }],
  });
}

describe('loadMeasuredVerification', () => {
  beforeEach(() => {
    events = [];
    findMany.mockClear();
  });

  test('does not query when the report has no claim block', async () => {
    expect(await loadMeasuredVerification(1, '# report')).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  test('does not query when the claim is malformed', async () => {
    expect(await loadMeasuredVerification(1, '```json:verify-claim\n{x\n```')).toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  test('queries by the claimed runId and the task id', async () => {
    await storeJob(7, 'run-x');
    const r = await loadMeasuredVerification(7, withClaim('run-x'));
    expect(findMany).toHaveBeenCalledWith({
      where: { correlationId: 'verify-job-7' },
      orderBy: { createdAt: 'desc' },
      take: 200,
      skip: 0,
    });
    expect(r?.job).toMatchObject({ taskId: 7, runId: 'run-x', status: 'completed' });
  });

  test('returns job null when the run belongs to no job of this task', async () => {
    const r = await loadMeasuredVerification(7, withClaim('run-x'));
    expect(r).toEqual({ job: null });
  });

  test('fails closed with the error when the lookup throws', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'));
    const r = await loadMeasuredVerification(7, withClaim('run-x'));
    expect(r).toEqual({ job: null, fetchError: 'db down' });
    const verdict = validateVerify(report('run-x'), undefined, r);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('job-missing');
    expect(verdict.summary).toContain('db down');
  });

  test('同一タスクの最新ジョブではなく主張した runId の実測を判定へ渡す（F7）', async () => {
    await storeJob(7, 'run-claimed');
    await storeJob(7, 'run-latest', false, 'other-revision');
    const content = report('run-claimed');
    const measured = await loadMeasuredVerification(7, content);
    expect(measured?.job).toMatchObject({
      runId: 'run-claimed',
      revision: SHA,
      ok: true,
      checks: [{ name: 'test', ran: true, errorCount: 0 }],
    });
    expect(validateVerify(content, undefined, measured).ok).toBe(true);
  });

  test('別タスクに実在する成功ジョブの runId は借用できない（F7）', async () => {
    await storeJob(7, 'run-local');
    await storeJob(8, 'run-foreign');
    const content = report('run-foreign');
    const measured = await loadMeasuredVerification(7, content);
    expect(measured).toEqual({ job: null });
    const verdict = validateVerify(content, undefined, measured);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('job-missing');
  });

  test('同一タスクに成功ジョブがあっても存在しない runId は差し戻す（F7）', async () => {
    await storeJob(7, 'run-existing');
    const content = report('run-unknown');
    const measured = await loadMeasuredVerification(7, content);
    expect(measured).toEqual({ job: null });
    const verdict = validateVerify(content, undefined, measured);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('job-missing');
  });

  test('runId が同じでも別タスクの成功結果が対象タスクの失敗を置き換えない（F7）', async () => {
    await storeJob(7, 'run-shared', false);
    await storeJob(8, 'run-shared');
    const content = report('run-shared');
    const measured = await loadMeasuredVerification(7, content);
    expect(measured?.job).toMatchObject({ taskId: 7, runId: 'run-shared', ok: false });
    const verdict = validateVerify(content, undefined, measured);
    expect(verdict.ok).toBe(false);
    expect(verdict.summary).toContain('job-not-ok');
  });
});
