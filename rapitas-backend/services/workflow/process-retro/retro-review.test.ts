/**
 * retro-review ユニットテスト
 *
 * runProcessRetro のオーケストレーション(トグルOFF/clean roundのAIスキップ、
 * AI例外・パース失敗のfail-open、起票ルール(最大2件・dedupKey形式))を、
 * sendAIMessage / submitConcern / appendEvent をモックして検証する。
 * NOTE: retro-review は動的importされる — mock.module はimport前に確立すること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// HACK(agent): Bun mock型推論の制限 — `as any`

const transitionFindMany = mock(() => Promise.resolve([])) as any;

const taskFindUnique = mock(() => Promise.resolve({ title: 'テストタスク' })) as any;
const userSettingsFindFirst = mock(() => Promise.resolve(null)) as any;
mock.module('../../../config/database', () => ({
  prisma: {
    workflowTransition: { findMany: transitionFindMany },
    task: { findUnique: taskFindUnique },
    userSettings: { findFirst: userSettingsFindFirst },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const sendAIMessage = mock(() =>
  Promise.resolve({ content: '{"findings":[]}', tokensUsed: 1 }),
) as any;
mock.module('../../../utils/ai-client', () => ({ sendAIMessage }));

const submitConcern = mock(() => Promise.resolve(1)) as any;
mock.module('../../memory/concern-backlog-service', () => ({ submitConcern }));

const appendEvent = mock(() => Promise.resolve()) as any;
mock.module('../../memory/timeline', () => ({ appendEvent }));

// トグルは実ストアを使う(不在=既定ON) — RAPITAS_DATA_DIR を一時ディレクトリへ隔離。
process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'retro-review-test-'));

const { runProcessRetro } = await import('./retro-review');
const { writeRetroReviewEnabled } = await import('./retro-settings-store');

let nextId = 1;
const row = (cause: string, atMs: number, toStatus = 'in_progress') => ({
  id: nextId++,
  fromStatus: 'draft',
  toStatus,
  actor: 'system',
  cause,
  phase: null,
  metadata: '{}',
  invariantViolation: false,
  createdAt: new Date(atMs),
});

/**
 * 修復系causeが既定予算(2回)を超える「クリーンでない」遷移履歴 — AI呼び出しへ
 * 到達する経路を検証する共通フィクスチャ。予算内(2回)は別途
 * isRoutineBudgetedRepair でスキップされるため(task 732)、3回にして over-budget
 * を保つ。
 */
const dirtyRows = () => [
  row('file_saved:research', 0, 'research_done'),
  row('verify_repair', 60_000),
  row('verify_repair', 120_000),
  row('verify_repair', 150_000),
  row('file_saved:verify', 180_000, 'completed'),
];

const aiFinding = (over: Record<string, unknown> = {}) => ({
  category: 'repair_loop',
  severity: 'high',
  systemic: true,
  slug: 'verify-repair-thrash',
  recommendation: '提出前に関連テストを実行する教育を行う。',
  evidence: 'verify_repair 1回',
  ...over,
});

beforeEach(() => {
  transitionFindMany.mockReset();
  transitionFindMany.mockResolvedValue(dirtyRows());
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue({ title: 'テストタスク' });
  userSettingsFindFirst.mockReset();
  userSettingsFindFirst.mockResolvedValue(null);
  sendAIMessage.mockReset();
  sendAIMessage.mockResolvedValue({ content: '{"findings":[]}', tokensUsed: 1 });
  submitConcern.mockReset();
  submitConcern.mockResolvedValue(1);
  appendEvent.mockReset();
  appendEvent.mockResolvedValue(undefined);
  writeRetroReviewEnabled(true);
});

describe('runProcessRetro', () => {
  test('トグルOFFならAIも起票も呼ばれない', async () => {
    writeRetroReviewEnabled(false);
    await runProcessRetro(1);
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(submitConcern).not.toHaveBeenCalled();
  });

  test('clean round(差し戻し0・修復0・異常0)はAI呼び出し自体をスキップ', async () => {
    transitionFindMany.mockResolvedValue([
      row('file_saved:research', 0, 'research_done'),
      row('file_saved:verify', 60_000, 'completed'),
    ]);
    await runProcessRetro(1);
    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(submitConcern).not.toHaveBeenCalled();
  });

  test('single routine repair is handled by code without an AI call', async () => {
    transitionFindMany.mockResolvedValue([
      row('file_saved:research', 0, 'research_done'),
      row('verify_repair', 60_000),
      row('file_saved:verify', 120_000, 'completed'),
    ]);

    await runProcessRetro(1);

    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(submitConcern).not.toHaveBeenCalled();
  });

  test('budget-exact repair (2 repairs within the default limit) is handled by code without an AI call (task 732 / #727)', async () => {
    transitionFindMany.mockResolvedValue([
      row('file_saved:research', 0, 'research_done'),
      row('verify_repair', 60_000),
      row('verify_repair', 120_000),
      row('file_saved:verify', 180_000, 'completed'),
    ]);

    await runProcessRetro(727);

    expect(sendAIMessage).not.toHaveBeenCalled();
    expect(submitConcern).not.toHaveBeenCalled();
  });

  test('a repair count exceeding a UserSettings-configured lower budget still calls the AI', async () => {
    userSettingsFindFirst.mockResolvedValue({ verifyRepairLimit: 1 });
    transitionFindMany.mockResolvedValue([
      row('file_saved:research', 0, 'research_done'),
      row('verify_repair', 60_000),
      row('verify_repair', 120_000),
      row('file_saved:verify', 180_000, 'completed'),
    ]);

    await runProcessRetro(1);

    expect(sendAIMessage).toHaveBeenCalledTimes(1);
  });

  test('happy path: systemicなfindingがdedupKey付きで起票される', async () => {
    sendAIMessage.mockResolvedValue({
      content: JSON.stringify({ findings: [aiFinding()] }),
      tokensUsed: 10,
    });
    await runProcessRetro(42);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
    expect(submitConcern).toHaveBeenCalledTimes(1);
    const arg = submitConcern.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.dedupKey).toBe('retro:repair_loop');
    expect(String(arg.dedupKey)).not.toContain('42');
    expect(arg.type).toBe('other');
    expect(arg.severity).toBe('high');
    expect(arg.source).toBe('process_retro');
    expect(arg.originTaskId).toBe(42);
    expect(String(arg.title)).toStartWith('[回顧] ');
    expect(String(arg.title).length).toBeLessThanOrEqual(120);
    expect(String(arg.detail)).toContain('証拠バンドル要約');
  });

  test('finding3件(全てsystemic高深刻度)でも起票は上位2件のみ', async () => {
    sendAIMessage.mockResolvedValue({
      content: JSON.stringify({
        findings: [
          aiFinding({ severity: 'high', slug: 'first-high' }),
          aiFinding({ severity: 'urgent', slug: 'the-urgent', category: 'critic_loop' }),
          aiFinding({ severity: 'high', slug: 'second-high' }),
        ],
      }),
      tokensUsed: 10,
    });
    await runProcessRetro(1);
    expect(submitConcern).toHaveBeenCalledTimes(2);
    const keys = submitConcern.mock.calls.map((c: [Record<string, unknown>]) => c[0].dedupKey);
    expect(keys).toEqual(['retro:critic_loop', 'retro:repair_loop']);
  });

  test('systemic=falseや閾値未満のみなら起票0(AIは1回呼ばれる)', async () => {
    sendAIMessage.mockResolvedValue({
      content: JSON.stringify({
        findings: [aiFinding({ systemic: false }), aiFinding({ severity: 'medium' })],
      }),
      tokensUsed: 10,
    });
    await runProcessRetro(1);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
    expect(submitConcern).not.toHaveBeenCalled();
  });

  test('AI例外はfail-open: 起票0 + retro_review_failedイベント', async () => {
    sendAIMessage.mockRejectedValue(new Error('補助AI機能は無効化されています'));
    await runProcessRetro(1);
    expect(submitConcern).not.toHaveBeenCalled();
    expect(appendEvent).toHaveBeenCalledTimes(1);
    const event = appendEvent.mock.calls[0][0] as { eventType: string };
    expect(event.eventType).toBe('retro_review_failed');
  });

  test('パース失敗はfail-open: 起票0 + retro_review_failedイベント', async () => {
    sendAIMessage.mockResolvedValue({ content: '評価不能でした(JSONなし)', tokensUsed: 5 });
    await runProcessRetro(1);
    expect(submitConcern).not.toHaveBeenCalled();
    const event = appendEvent.mock.calls[0][0] as {
      eventType: string;
      payload: Record<string, unknown>;
    };
    expect(event.eventType).toBe('retro_review_failed');
    expect(event.payload.reason).toBe('parse_failed');
  });

  test('submitConcernの例外もfail-open(外へ投げない)', async () => {
    sendAIMessage.mockResolvedValue({
      content: JSON.stringify({ findings: [aiFinding()] }),
      tokensUsed: 10,
    });
    submitConcern.mockRejectedValue(new Error('backlog down'));
    await expect(runProcessRetro(1)).resolves.toBeUndefined();
    expect(appendEvent).toHaveBeenCalledTimes(1);
  });
});
