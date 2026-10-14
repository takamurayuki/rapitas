/**
 * delivery-funnel.test
 *
 * 実測（2026-10-14）。各段で何件が次に進んだかは手で数えないと見えなかった。
 *
 * DB 実測:
 *   theme          filed  started  verified  merged  feature  feat-done
 *   rapitas          654      593       583     491        0          0
 *   TempoRaid         16       15        15      12       12         12
 *   ContextFlow        9        4         4       2        4          1
 *
 * **TempoRaid の「機能12件すべて完了」が、この指標が隠してはいけない数字**。
 * A6 の監査で、12件のうち 11件は出荷された画面から到達できないと分かっている
 * （apps/web/src の .tsx は4本だけ、game/scene.ts は29行の空の足場）。
 * マージ済み ≠ 動く。だから merged を最終段として「成功」と呼ばない。
 *
 * 文書側（要件書に N 機能）は DB に無く、生成プロジェクトのドキュメント
 * ファイルにある。呼び出し側が解析して渡す。
 */
import { describe, expect, test } from 'bun:test';
import { computeDeliveryFunnel, type FunnelTask } from './delivery-funnel';

const task = (over: Partial<FunnelTask> = {}): FunnelTask => ({
  id: 1,
  title: 'x',
  status: 'todo',
  workflowStatus: null,
  githubPrId: null,
  ...over,
});

describe('computeDeliveryFunnel', () => {
  test('空なら全段0で、歩留まりは null（0除算にしない）', () => {
    const f = computeDeliveryFunnel({ tasks: [] });
    expect(f.filed).toBe(0);
    expect(f.documented).toBeNull();
    expect(f.filedPerDocumented).toBeNull();
    expect(f.mergedPerFiled).toBeNull();
  });

  test('段ごとに数える', () => {
    const f = computeDeliveryFunnel({
      tasks: [
        task({ id: 1 }), // filed only
        task({ id: 2, workflowStatus: 'draft' }), // draft is not started
        task({ id: 3, workflowStatus: 'plan_approved' }), // started
        task({ id: 4, workflowStatus: 'verify_done' }), // verified
        task({ id: 5, status: 'done', workflowStatus: 'completed', githubPrId: 9 }), // merged
      ],
    });
    expect(f).toMatchObject({ filed: 5, started: 3, verified: 2, merged: 1 });
  });

  test('done は workflowStatus に関わらず verified に数える', () => {
    const f = computeDeliveryFunnel({ tasks: [task({ status: 'done', workflowStatus: null })] });
    expect(f.verified).toBe(1);
  });

  test('cancelled は filed に数えるが先へは進めない', () => {
    const f = computeDeliveryFunnel({
      tasks: [task({ status: 'cancelled', workflowStatus: 'plan_approved' })],
    });
    expect(f).toMatchObject({ filed: 1, started: 0, verified: 0, merged: 0 });
  });

  test('文書側を渡すと最初の歩留まりが出る', () => {
    const f = computeDeliveryFunnel({
      documentedFeatures: ['F-01', 'F-02', 'F-03', 'F-04'],
      tasks: [task({ id: 1, title: '[F-01] a' }), task({ id: 2, title: '[F-02] b' })],
    });
    expect(f.documented).toBe(4);
    expect(f.filedPerDocumented).toBeCloseTo(0.5, 6);
  });

  test('同じ機能に複数タスクがあっても機能単位で数える', () => {
    const f = computeDeliveryFunnel({
      documentedFeatures: ['F-01', 'F-02'],
      tasks: [task({ id: 1, title: '[F-01] a' }), task({ id: 2, title: '[F-01] a の修正' })],
    });
    expect(f.filedFeatures).toEqual(['F-01']);
    expect(f.filedPerDocumented).toBeCloseTo(0.5, 6);
  });

  test('文書に無い機能IDを起票していたら報告する（歩留まりを1超にしない）', () => {
    const f = computeDeliveryFunnel({
      documentedFeatures: ['F-01'],
      tasks: [task({ id: 1, title: '[F-01] a' }), task({ id: 2, title: '[F-09] 文書に無い' })],
    });
    expect(f.filedPerDocumented).toBeCloseTo(1, 6);
    expect(f.undocumentedFeatures).toEqual(['F-09']);
  });

  // 実測 TempoRaid。merged を成功として見せないことが要点。
  test('実測 TempoRaid: マージ済み12件を runtime 未確認として区別する', () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task({
        id: 100 + i,
        title: `[F-${String(i + 1).padStart(2, '0')}] 機能`,
        status: 'done',
        workflowStatus: 'completed',
        githubPrId: 500 + i,
      }),
    );
    const f = computeDeliveryFunnel({
      documentedFeatures: tasks.map((_, i) => `F-${String(i + 1).padStart(2, '0')}`),
      tasks,
    });
    expect(f).toMatchObject({ filed: 12, verified: 12, merged: 12 });
    // 最終段は merged であり、動作確認ではない — それを呼び出し側に明示する。
    expect(f.runtimeVerified).toBeNull();
    expect(f.caveat).toContain('runtime');
  });

  // 宣言は角括弧付き（タスク表題の規約 `[F-02] …`）。本文中の素の言及を
  // 機能の起票と数えると、歩留まりが実態より良く見える。
  test('角括弧の無い素の言及は機能の起票と数えない', () => {
    const f = computeDeliveryFunnel({
      documentedFeatures: ['F-01'],
      tasks: [
        task({ id: 1, title: '[Bug] 何か' }),
        task({ id: 2, title: 'F-01 の設計方針について相談' }),
      ],
    });
    expect(f.filedFeatures).toEqual([]);
    expect(f.filedPerDocumented).toBe(0);
  });
});
