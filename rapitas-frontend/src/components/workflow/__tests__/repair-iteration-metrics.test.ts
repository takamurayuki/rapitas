/**
 * repair-iteration-metrics ユニットテスト
 *
 * GET /tasks/:taskId/repair-iterations レスポンスの検証・不正行の除外を検証する。
 */
import { parseRepairIterationMetrics } from '../repair-iteration-metrics';

describe('parseRepairIterationMetrics', () => {
  it('整形済みエントリをそのまま通す', () => {
    const raw = [
      {
        id: 'repair-0',
        cause: 'verify_repair',
        createdAt: '2026-08-01T00:00:00.000Z',
        dwellTimeMs: null,
        changeSet: null,
      },
      {
        id: 'repair-1',
        cause: 'ci_repair',
        createdAt: '2026-08-01T00:05:00.000Z',
        dwellTimeMs: 300000,
        changeSet: { filesChanged: 3, additions: 30, deletions: 5 },
      },
    ];
    const result = parseRepairIterationMetrics(raw);
    expect(result).toHaveLength(2);
    expect(result[1].changeSet).toEqual({ filesChanged: 3, additions: 30, deletions: 5 });
  });

  it('配列でない入力は空配列を返す', () => {
    expect(parseRepairIterationMetrics(null)).toEqual([]);
    expect(parseRepairIterationMetrics(undefined)).toEqual([]);
    expect(parseRepairIterationMetrics({})).toEqual([]);
  });

  it('cause が不正な行を除外する', () => {
    const raw = [
      {
        id: 'repair-0',
        cause: 'unknown_cause',
        createdAt: '2026-08-01T00:00:00.000Z',
        dwellTimeMs: null,
        changeSet: null,
      },
    ];
    expect(parseRepairIterationMetrics(raw)).toEqual([]);
  });

  it('changeSet の型が不正な行を除外する', () => {
    const raw = [
      {
        id: 'repair-0',
        cause: 'verify_repair',
        createdAt: '2026-08-01T00:00:00.000Z',
        dwellTimeMs: null,
        changeSet: { filesChanged: '3', additions: 30, deletions: 5 },
      },
    ];
    expect(parseRepairIterationMetrics(raw)).toEqual([]);
  });

  it('必須フィールドが欠けた行を除外する', () => {
    const raw = [{ id: 'repair-0', cause: 'verify_repair' }];
    expect(parseRepairIterationMetrics(raw)).toEqual([]);
  });
});
