/**
 * repair-iteration-metrics テスト
 *
 * 反復ごとの滞留時間（前反復からの経過時間）と変更セットサイズ（ウィンドウ内の
 * auto_commit_created 集計）の導出を検証する（task #672, MVP限定スコープ）。
 */
import { describe, test, expect } from 'bun:test';
import { computeRepairIterationMetrics } from '../../services/workflow/repair-iteration-metrics';

describe('computeRepairIterationMetrics', () => {
  test('先頭反復の dwellTimeMs は null、以降は前反復からの経過時間', () => {
    const transitions = [
      { id: 1, cause: 'verify_repair', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 2, cause: 'ci_repair', createdAt: '2026-08-01T00:05:00.000Z' },
      { id: 3, cause: 'verify_repair', createdAt: '2026-08-01T00:15:00.000Z' },
    ];
    const result = computeRepairIterationMetrics(transitions, []);
    expect(result).toHaveLength(3);
    expect(result[0].dwellTimeMs).toBeNull();
    expect(result[1].dwellTimeMs).toBe(5 * 60_000);
    expect(result[2].dwellTimeMs).toBe(10 * 60_000);
  });

  test('非修復原因の遷移は除外される', () => {
    const transitions = [
      { id: 1, cause: 'file_saved:verify', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 2, cause: null, createdAt: '2026-08-01T00:01:00.000Z' },
      { id: 3, cause: 'research_critic_failed', createdAt: '2026-08-01T00:02:00.000Z' },
    ];
    expect(computeRepairIterationMetrics(transitions, [])).toHaveLength(0);
  });

  test('ウィンドウ内のコミットのみ変更セットに集計する（境界: 前反復以前は除外、次反復と同時刻は含む）', () => {
    const transitions = [
      { id: 1, cause: 'verify_repair', createdAt: '2026-08-01T00:00:00.000Z' },
      { id: 2, cause: 'verify_repair', createdAt: '2026-08-01T00:10:00.000Z' },
    ];
    const commits = [
      // 1反復目のウィンドウ(下限なし〜00:00)に含まれる — 前日でも windowStart が null なら対象
      { createdAt: '2026-07-31T23:00:00.000Z', filesChanged: 9, additions: 900, deletions: 900 },
      // 同じく1反復目のウィンドウ内
      { createdAt: '2026-07-31T23:59:00.000Z', filesChanged: 2, additions: 20, deletions: 5 },
      // 2反復目のウィンドウ内(00:00超〜00:10)
      { createdAt: '2026-08-01T00:05:00.000Z', filesChanged: 3, additions: 30, deletions: 10 },
      // 2反復目と同時刻 — 含む(<=windowEnd)
      { createdAt: '2026-08-01T00:10:00.000Z', filesChanged: 1, additions: 1, deletions: 0 },
    ];
    const result = computeRepairIterationMetrics(transitions, commits);
    expect(result[0].changeSet).toEqual({ filesChanged: 11, additions: 920, deletions: 905 });
    expect(result[1].changeSet).toEqual({ filesChanged: 4, additions: 31, deletions: 10 });
  });

  test('ウィンドウ内にコミットが無い反復は changeSet が null', () => {
    const transitions = [{ id: 1, cause: 'ci_repair', createdAt: '2026-08-01T00:00:00.000Z' }];
    expect(computeRepairIterationMetrics(transitions, []).at(0)?.changeSet).toBeNull();
  });

  test('id が無い行はインデックスからユニークIDを生成する', () => {
    const transitions = [
      { cause: 'verify_repair', createdAt: '2026-08-01T00:00:00.000Z' },
      { cause: 'ci_repair', createdAt: '2026-08-01T00:01:00.000Z' },
    ];
    const result = computeRepairIterationMetrics(transitions, []);
    expect(result[0].id).toBe('repair-0');
    expect(result[1].id).toBe('repair-1');
  });
});
