/**
 * repair-cycle-cost.test
 *
 * 実測（2026-10-13/14）。修復周回ごとの費用・キャッシュ・単価は、事後に手で
 * SQL を書かないと見えなかった。今日それで3回誤った推論をしている。
 *
 * #1214 を正しい増分コスト（C1 で修正）で周回別に見た実測値:
 *   周1  4実行  95呼  cacheRead 5,560,569  cacheCreate   417,531  出力 117,902  $2.89  $0.030/呼
 *   周2  4実行  79呼            9,210,572             600,890      154,237  $4.16  $0.053/呼
 *   周3  3実行   9呼            2,627,050             592,339       58,126  $2.37  $0.264/呼
 *   周4  4実行  15呼            6,168,945           1,152,459       17,393  $5.40  $0.360/呼
 *
 * 単価 11.8倍。しかも仕事量は逆に激減している（95呼/出力118k → 15呼/出力17k）。
 * 周4 は周1 の 1/7 の出力に対し約2倍の費用。
 *
 * 130タスクの分布: 中央値 1.18倍、2倍以上が 31件(24%)、3倍以上 16件、5倍以上 5件、
 * 最大 11.82倍。中央値が小さいので 2倍を注意域の既定とする。
 */
import { describe, expect, test } from 'bun:test';
import {
  computeRepairCycleCosts,
  detectUnitCostTrend,
  type RawCycleExecution,
} from './repair-cycle-cost';

/** Minutes after an arbitrary epoch, so fixtures read as a timeline. */
const T = (minutes: number): Date => new Date(Date.UTC(2026, 9, 13, 0, minutes));

const exec = (
  minutes: number,
  costUsd: number,
  calls: number,
  extra: Partial<RawCycleExecution> = {},
): RawCycleExecution => ({
  startedAt: T(minutes),
  costUsd,
  claudeSessionId: null,
  llmCallCount: calls,
  ...extra,
});

describe('computeRepairCycleCosts', () => {
  test('差し戻しが無ければ全実行が周1', () => {
    const cycles = computeRepairCycleCosts([], [exec(1, 1, 10), exec(2, 2, 20)]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ cycle: 1, executions: 2, llmCalls: 30, costUsd: 3 });
  });

  test('差し戻しの時刻で周を区切る', () => {
    const cycles = computeRepairCycleCosts([T(10)], [exec(5, 1, 10), exec(15, 3, 5)]);
    expect(cycles.map((c) => c.cycle)).toEqual([1, 2]);
    expect(cycles[0]).toMatchObject({ executions: 1, llmCalls: 10, costUsd: 1 });
    expect(cycles[1]).toMatchObject({ executions: 1, llmCalls: 5, costUsd: 3 });
  });

  test('差し戻し時刻と同時刻の実行は次の周に入れる（境界は次周の開始）', () => {
    const cycles = computeRepairCycleCosts([T(10)], [exec(10, 2, 4)]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toBe(2);
  });

  test('単価を出す。呼び出し0の周は null（0除算にしない）', () => {
    const cycles = computeRepairCycleCosts([T(10)], [exec(5, 2, 8), exec(15, 1, 0)]);
    expect(cycles[0].costPerLlmCall).toBeCloseTo(0.25, 6);
    expect(cycles[1].costPerLlmCall).toBeNull();
  });

  test('キャッシュと出力トークンを周ごとに集計する', () => {
    const cycles = computeRepairCycleCosts(
      [],
      [
        exec(1, 1, 1, { cacheReadInputTokens: 100, cacheCreationInputTokens: 10, outputTokens: 5 }),
        exec(2, 1, 1, { cacheReadInputTokens: 200, cacheCreationInputTokens: 20, outputTokens: 7 }),
      ],
    );
    expect(cycles[0]).toMatchObject({ cacheRead: 300, cacheCreate: 30, outputTokens: 12 });
  });

  // costUsd はセッション累計なので、合算ではなく増分で数える（C1）。
  test('同一セッションの累計コストを二重に数えない', () => {
    const cycles = computeRepairCycleCosts(
      [],
      [
        { startedAt: T(1), costUsd: 1.94, claudeSessionId: 's1', llmCallCount: 10 },
        { startedAt: T(2), costUsd: 8.86, claudeSessionId: 's1', llmCallCount: 10 },
      ],
    );
    expect(cycles[0].costUsd).toBeCloseTo(8.86, 6);
  });

  test('開始時刻の無い実行は最後の周に入れる（これから走るもの）', () => {
    const cycles = computeRepairCycleCosts(
      [T(10)],
      [exec(5, 1, 1), { startedAt: null, costUsd: 2, claudeSessionId: null, llmCallCount: 1 }],
    );
    expect(cycles.find((c) => c.cycle === 2)?.costUsd).toBe(2);
  });

  test('実行が無ければ空', () => {
    expect(computeRepairCycleCosts([T(1)], [])).toEqual([]);
  });

  test('実行が無い周は行を作らない（存在しない周を報告しない）', () => {
    const cycles = computeRepairCycleCosts([T(10), T(20)], [exec(5, 1, 1), exec(25, 1, 1)]);
    expect(cycles.map((c) => c.cycle)).toEqual([1, 3]);
  });

  // 実測の #1214。周を跨いで単価が上がり、仕事量は減る形。
  test('実測 #1214 の形を再現する', () => {
    const cycles = computeRepairCycleCosts(
      [T(10), T(20), T(30)],
      [
        exec(1, 2.89, 95, { outputTokens: 117_902, cacheCreationInputTokens: 417_531 }),
        exec(11, 4.16, 79, { outputTokens: 154_237, cacheCreationInputTokens: 600_890 }),
        exec(21, 2.37, 9, { outputTokens: 58_126, cacheCreationInputTokens: 592_339 }),
        exec(31, 5.4, 15, { outputTokens: 17_393, cacheCreationInputTokens: 1_152_459 }),
      ],
    );
    expect(cycles.map((c) => c.cycle)).toEqual([1, 2, 3, 4]);
    expect(cycles[0].costPerLlmCall).toBeCloseTo(0.0304, 3);
    expect(cycles[3].costPerLlmCall).toBeCloseTo(0.36, 3);
    // 仕事量が減りながら費用が増えている、という形そのもの。
    expect(cycles[3].outputTokens).toBeLessThan(cycles[0].outputTokens);
    expect(cycles[3].costUsd).toBeGreaterThan(cycles[0].costUsd);
  });
});

describe('detectUnitCostTrend', () => {
  const cycle = (c: number, cost: number, calls: number) => ({
    cycle: c,
    executions: 1,
    llmCalls: calls,
    cacheRead: 0,
    cacheCreate: 0,
    outputTokens: 0,
    costUsd: cost,
    costPerLlmCall: calls > 0 ? cost / calls : null,
  });

  test('実測 #1214: 11.8倍は悪化として報告する', () => {
    const t = detectUnitCostTrend([cycle(1, 2.89, 95), cycle(4, 5.4, 15)]);
    expect(t.worsening).toBe(true);
    expect(t.ratio).toBeCloseTo(11.82, 1);
  });

  // 130タスクの中央値は 1.18倍。通常のゆらぎを悪化と呼んではいけない。
  test('中央値付近のゆらぎ（1.18倍）は悪化としない', () => {
    const t = detectUnitCostTrend([cycle(1, 1, 10), cycle(2, 1.18, 10)]);
    expect(t.worsening).toBe(false);
    expect(t.ratio).toBeCloseTo(1.18, 2);
  });

  test('閾値は引数で変えられる', () => {
    const cycles = [cycle(1, 1, 10), cycle(2, 2.5, 10)];
    expect(detectUnitCostTrend(cycles, 2).worsening).toBe(true);
    expect(detectUnitCostTrend(cycles, 3).worsening).toBe(false);
  });

  test('単価が下がる場合は悪化としない', () => {
    const t = detectUnitCostTrend([cycle(1, 5, 10), cycle(2, 1, 10)]);
    expect(t.worsening).toBe(false);
    expect(t.ratio).toBeCloseTo(0.2, 6);
  });

  test('単価の出せる周が1つ以下なら判定しない', () => {
    expect(detectUnitCostTrend([cycle(1, 1, 10)])).toEqual({
      worsening: false,
      firstPerCall: null,
      lastPerCall: null,
      ratio: null,
    });
    expect(detectUnitCostTrend([]).worsening).toBe(false);
  });

  test('単価が出せない周（呼び出し0）は比較から除く', () => {
    const t = detectUnitCostTrend([cycle(1, 1, 10), cycle(2, 9, 0), cycle(3, 3, 10)]);
    expect(t.ratio).toBeCloseTo(3, 6);
  });
});
