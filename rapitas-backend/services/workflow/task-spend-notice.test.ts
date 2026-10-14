/**
 * task-spend-notice.test
 *
 * 実測 2026-10-14、653タスク・$7,048.73（C1/C4 の増分帰属で測り直した実額）:
 *
 *   タスク単位の費用: 中央値 $5.86 / p75 $13.86 / p90 $28.52 / p95 $37.71 / 最大 $69.96
 *
 *   閾値    超過  うち未完  費用で halt した数
 *   $15     153     8        1
 *   $25      76     4        0
 *
 * 段の選び方も出荷モジュールでシミュレーションした（verify-c2）:
 *   [25,50] = 通知76件(12%)・未完12件中4件 / [15,30] = 153件(23%)・8件 /
 *   [10,25,50] = 224件(34%)・12件。既定は [15,30]。
 *
 * **$25 の費用上限は、実際に $25 を超えたタスクに一度も作動していない。**
 * 窓内集計なので retry / 質問回答 / replan のたびに積算が落ちる。作動した 2 件は
 * #1160 $13.13 と #1174 $17.96 — どちらも上限の半分以下で、原因は多重計上だった。
 *
 * そして「低い閾値で止める」は誤り: $15 を超えた 153 件のうち 145 件は完走している。
 * 止めるべきではなく、人に見せるべき。見せる相手がいなかったのは
 * 「$10以上使って未完で終わった 12 件・計 $306.94」（cancelled/todo のまま）。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const findManyMock = mock(() => Promise.resolve([] as { metadata: unknown }[]));
mock.module('../../config', () => ({
  prisma: { workflowTransition: { findMany: findManyMock } },
}));

const recordTransitionMock = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({ recordTransition: recordTransitionMock }));

const createNotificationMock = mock(() => Promise.resolve({}));
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

let lifetimeUsd: number | Error = 0;
mock.module('./task-budget', () => ({
  getTaskSpendUsd: async () => {
    if (lifetimeUsd instanceof Error) throw lifetimeUsd;
    return lifetimeUsd;
  },
}));

const {
  spendNoticeTiersUsd,
  resolveSpendNoticeTier,
  reportTaskSpendNotice,
  reportLifetimeSpendNotice,
} = await import('./task-spend-notice');

describe('spendNoticeTiersUsd', () => {
  afterEach(() => {
    delete process.env.RAPITAS_TASK_SPEND_NOTICE_USD;
  });

  test('既定は $15 とその倍（実測の trade-off 表から選んだ）', () => {
    expect(spendNoticeTiersUsd()).toEqual([15, 30]);
  });

  test('env で上書きでき、昇順に並べる', () => {
    process.env.RAPITAS_TASK_SPEND_NOTICE_USD = '40, 10 , 20';
    expect(spendNoticeTiersUsd()).toEqual([10, 20, 40]);
  });

  test('壊れた env は既定に戻す（通知が無言で消えるより既定で鳴る方がよい）', () => {
    process.env.RAPITAS_TASK_SPEND_NOTICE_USD = 'abc,,-5';
    expect(spendNoticeTiersUsd()).toEqual([15, 30]);
  });
});

describe('resolveSpendNoticeTier', () => {
  test('最初の段に届かなければ通知しない', () => {
    expect(resolveSpendNoticeTier(14.99, 0)).toBeNull();
  });

  test('段を超えたらその段を返す', () => {
    expect(resolveSpendNoticeTier(15, 0)).toBe(15);
    expect(resolveSpendNoticeTier(17.46, 0)).toBe(15);
  });

  // 同じ段で毎 tick 鳴らすと、通知が読まれなくなる方向に働く。
  test('同じ段では二度通知しない', () => {
    expect(resolveSpendNoticeTier(17.46, 15)).toBeNull();
  });

  test('次の段に達したら通知する', () => {
    expect(resolveSpendNoticeTier(40.32, 15)).toBe(30);
  });

  // 一気に飛んだ場合に $15 と $30 を続けて鳴らすと、古い段の通知が
  // 「いまの状態」として読まれる。到達している最上段だけを出す。
  test('段を飛び越えたら到達している最上段だけを返す', () => {
    expect(resolveSpendNoticeTier(69.96, 0)).toBe(30);
  });

  test('最上段を通知済みなら、それ以上は鳴らさない', () => {
    expect(resolveSpendNoticeTier(120, 30)).toBeNull();
  });
});

describe('reportTaskSpendNotice', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    recordTransitionMock.mockClear();
    createNotificationMock.mockClear();
  });

  test('初回は transition と通知を1件ずつ書き、段を返す', async () => {
    findManyMock.mockResolvedValueOnce([]);
    const tier = await reportTaskSpendNotice(1214, 17.46, 'in_progress');
    expect(tier).toBe(15);
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const [args] = recordTransitionMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toMatchObject({
      taskId: 1214,
      cause: 'task_spend_notice',
      metadata: { tier: 15, lifetimeUsd: 17.46 },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  test('同じ段の記録があれば何も書かない', async () => {
    findManyMock.mockResolvedValueOnce([{ metadata: { tier: 15 } }]);
    expect(await reportTaskSpendNotice(1214, 17.46, 'in_progress')).toBeNull();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  test('JSON 文字列で保存された過去の段も読む', async () => {
    findManyMock.mockResolvedValueOnce([{ metadata: '{"tier":30}' }]);
    expect(await reportTaskSpendNotice(1214, 69.96, 'in_progress')).toBeNull();
  });

  // これは情報提供の経路であって、ループを止めるゲートではない。読めなかった
  // ことを理由にディスパッチを壊してはいけない（fail-closed とは逆向き）。
  test('履歴が読めなければ通知せず、例外も投げない', async () => {
    findManyMock.mockRejectedValueOnce(new Error('db down'));
    expect(await reportTaskSpendNotice(1214, 99, 'in_progress')).toBeNull();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  // Anything reading the history must not mistake a notice for a halt: the row
  // is a no-op transition with no invariant violation. The halt-side cause
  // filter (isHaltSideTransitionCause) and the no-progress scan both read these
  // rows, and a status CHANGE here would look like work.
  test('止める記録には見えない形で書く（通知のみ）', async () => {
    findManyMock.mockResolvedValueOnce([]);
    const tier = await reportTaskSpendNotice(1214, 60, 'verify_done');
    expect(tier).toBe(30);
    const [args] = recordTransitionMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toMatchObject({ fromStatus: 'verify_done', toStatus: 'verify_done' });
    expect(args.invariantViolation).toBeUndefined();
  });
});

describe('reportLifetimeSpendNotice', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    recordTransitionMock.mockClear();
    lifetimeUsd = 0;
  });

  test('生涯費用を読んで段を通知する（窓内ではない）', async () => {
    findManyMock.mockResolvedValueOnce([]);
    lifetimeUsd = 17.46;
    expect(await reportLifetimeSpendNotice(1214, 'in_progress')).toBe(15);
  });

  // ディスパッチ判定の中から呼ばれる。費用が読めないことで配車を壊してはいけない。
  test('費用の読み取りが失敗しても例外を投げずに null を返す', async () => {
    lifetimeUsd = new Error('spend read failed');
    expect(await reportLifetimeSpendNotice(1214, 'in_progress')).toBeNull();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });
});
