/**
 * requirement-intake-outcome.test
 *
 * F1's remaining shape. 実測 2026-10-14:
 *
 *   TempoRaid: requirements.md あり / manifest あり / タスク16件（done 15・
 *   cancelled 1 = 未着手0）/ プレビュー設定は Theme.runtimeConfigJson も
 *   rapitas.runtime.json も無し / 環境構築タスク #1153・#1213 は両方 done。
 *
 * つまり needsEnvironmentBootstrap が恒久的に true、既起票チェックが再起票を
 * 抑止、intake は毎日 0 件を返し、テーマは仕事ゼロで静止する。痕跡は WARN 1行だけ。
 *
 * ContextFlow は同じく runtimeConfigJson が空文字だが rapitas.runtime.json が
 * ディスク上にあるため通常経路に入る — だから判定は「列」ではなく「設定の有無」
 * で行う。ただし別の理由で止まっている: 未着手5件に対し上限3で、機能5件が未起票。
 * 稼働中の2テーマが別々の理由で止まっており、どちらも何も言っていなかった。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const notifyOnceMock = mock(() => Promise.resolve(true));
mock.module('../communication/notify-once-per-window', () => ({
  notifyOncePerWindow: notifyOnceMock,
}));

const logCycleEventMock = mock((_name: string, _fields: unknown) => {});
mock.module('../observability', () => ({ logCycleEvent: logCycleEventMock }));

const { isSilentStall, describeIntakeOutcome, reportIntakeOutcome } =
  await import('./requirement-intake-outcome');

describe('isSilentStall', () => {
  test.each([
    ['throttled', true],
    ['filed', false],
    ['all_filed', false],
  ] as const)('%s -> %s', (kind, expected) => {
    expect(isSilentStall({ themeId: 1, kind, filed: 0 })).toBe(expected);
  });

  // 起票済みのテーマを毎回報告すると、本物の停止がその中に埋もれる。
  test('all_filed は正常なので報告しない', () => {
    expect(isSilentStall({ themeId: 1, kind: 'all_filed', filed: 0 })).toBe(false);
  });

  // 実測が設計を1つ却下した。この2種を停止扱いにすると、稼働中の8テーマのうち
  // 7件が毎日報告対象になる（rapitas / tripla / UIカタログ / trendline は要件定義
  // ドキュメントを持たないプロジェクト、fusen / コンバーター は [F-NN] を使わない
  // 文書形式でタスクは正常に進んでいる）。修正後は 2/8 — TempoRaid
  // (environment_pending) と ContextFlow (throttled: 未着手5件 / 上限3)。
  test.each(['requirements_missing', 'no_features_declared'] as const)(
    '%s は停止扱いにしない（実測 7/8 が誤報になる）',
    (kind) => {
      expect(isSilentStall({ themeId: 1, kind, filed: 0 })).toBe(false);
    },
  );

  // 環境構築タスクが open のうちは正当な待ちで、停止ではない。
  test('環境構築タスクが未完了なら停止扱いにしない', () => {
    expect(
      isSilentStall({ themeId: 35, kind: 'environment_pending', filed: 0, setupDone: false }),
    ).toBe(false);
  });

  test('環境構築タスクが完了済みなら出口が無いので停止扱い（TempoRaid の形）', () => {
    expect(
      isSilentStall({ themeId: 35, kind: 'environment_pending', filed: 0, setupDone: true }),
    ).toBe(true);
  });

  // setupDone が分からない（dep 未注入）ときに停止と決めつけると誤報になる。
  test('setupDone が不明なら報告しない', () => {
    expect(isSilentStall({ themeId: 35, kind: 'environment_pending', filed: 0 })).toBe(false);
  });
});

describe('describeIntakeOutcome', () => {
  test('throttle は実数を出す（「保留中」だけでは動けない）', () => {
    const text = describeIntakeOutcome({
      themeId: 34,
      kind: 'throttled',
      filed: 0,
      pending: 4,
      unstarted: 10,
      cap: 10,
    });
    expect(text).toContain('10/10');
    expect(text).toContain('4');
  });

  test('環境構築の説明は、何が足りないかを名指しする', () => {
    const text = describeIntakeOutcome({
      themeId: 35,
      kind: 'environment_pending',
      filed: 0,
      setupDone: true,
    });
    expect(text).toContain('rapitas.runtime.json');
    expect(text).toContain('未マージ');
  });

  test.each(['all_filed', 'filed', 'requirements_missing', 'no_features_declared'] as const)(
    '報告対象でない %s には文面を持たない',
    (kind) => {
      expect(describeIntakeOutcome({ themeId: 1, kind, filed: 0 })).toBe('');
    },
  );
});

describe('reportIntakeOutcome', () => {
  beforeEach(() => {
    notifyOnceMock.mockClear();
    logCycleEventMock.mockClear();
  });

  test('停止ならサイクルイベントと通知を1件ずつ出す', async () => {
    const reported = await reportIntakeOutcome(
      { themeId: 35, kind: 'environment_pending', filed: 0, setupDone: true },
      1_000,
    );
    expect(reported).toBe(true);
    expect(logCycleEventMock).toHaveBeenCalledTimes(1);
    const [name, fields] = logCycleEventMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('intake.stalled');
    expect(fields).toMatchObject({ theme: 35, ok: false, cause: 'environment_pending' });
    expect(notifyOnceMock).toHaveBeenCalledTimes(1);
  });

  test('正常な結果には何も出さない', async () => {
    expect(await reportIntakeOutcome({ themeId: 1, kind: 'all_filed', filed: 0 })).toBe(false);
    expect(logCycleEventMock).not.toHaveBeenCalled();
    expect(notifyOnceMock).not.toHaveBeenCalled();
  });

  test('通知はテーマ単位で重複抑止に渡す（毎日鳴らし続けない）', async () => {
    await reportIntakeOutcome(
      { themeId: 35, kind: 'throttled', filed: 0, pending: 3, unstarted: 10, cap: 10 },
      5_000,
    );
    const [args] = notifyOnceMock.mock.calls[0] as [Record<string, unknown>];
    expect(args).toMatchObject({ link: '/themes/35', nowMs: 5_000 });
    expect(String(args.title)).toContain('要件定義');
  });
});
