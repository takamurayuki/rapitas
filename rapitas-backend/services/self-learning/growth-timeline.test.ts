/**
 * growth-timeline テスト
 *
 * computeGrowthTimeline の純関数コアを検証: 累積カウント、成功率、そして
 * 信頼度が「全履歴の累積平均」ではなく「7日トレーリング窓の終端実験平均」に
 * なっていること(旧実装のフラットライン再発防止)。
 */
import { describe, test, expect } from 'bun:test';
import { computeGrowthTimeline, type TimelineSeries } from './growth-timeline';

function d(iso: string): Date {
  return new Date(iso);
}

function emptySeries(): TimelineSeries {
  return { nodeDates: [], edgeDates: [], patternDates: [], promptDates: [], experiments: [] };
}

describe('computeGrowthTimeline', () => {
  test('counts are cumulative per day', () => {
    const series = emptySeries();
    series.nodeDates = [d('2026-07-01T10:00:00Z'), d('2026-07-03T10:00:00Z')];
    series.patternDates = [d('2026-07-02T10:00:00Z')];

    const timeline = computeGrowthTimeline(['2026-07-01', '2026-07-02', '2026-07-03'], series);
    expect(timeline.map((t) => t.knowledgeNodes)).toEqual([1, 1, 2]);
    expect(timeline.map((t) => t.learningPatterns)).toEqual([0, 1, 1]);
  });

  test('success rate = completed / created-to-date', () => {
    const series = emptySeries();
    series.experiments = [
      {
        createdAt: d('2026-07-01T09:00:00Z'),
        completedAt: d('2026-07-01T10:00:00Z'),
        status: 'completed',
        confidence: 0.9,
      },
      {
        createdAt: d('2026-07-02T09:00:00Z'),
        completedAt: d('2026-07-02T10:00:00Z'),
        status: 'failed',
        confidence: 0.1,
      },
    ];
    const timeline = computeGrowthTimeline(['2026-07-01', '2026-07-02'], series);
    expect(timeline[0].successRate).toBe(1);
    expect(timeline[1].successRate).toBe(0.5);
  });

  test('confidence is a trailing-window mean over terminal experiments, NOT cumulative', () => {
    const series = emptySeries();
    series.experiments = [
      // Day 1: high-confidence success.
      {
        createdAt: d('2026-07-01T09:00:00Z'),
        completedAt: d('2026-07-01T10:00:00Z'),
        status: 'completed',
        confidence: 0.9,
      },
      // Day 10 (outside day 1's window, day 1 outside day 10's): low failure.
      {
        createdAt: d('2026-07-10T09:00:00Z'),
        completedAt: d('2026-07-10T10:00:00Z'),
        status: 'failed',
        confidence: 0.1,
      },
    ];
    const timeline = computeGrowthTimeline(['2026-07-01', '2026-07-09', '2026-07-10'], series);
    // Day 1 window: only the 0.9 success.
    expect(timeline[0].avgConfidence).toBeCloseTo(0.9);
    // Day 9: the 0.9 from day 1 falls out of the 7-day window; nothing new → 0 (no data).
    expect(timeline[1].avgConfidence).toBe(0);
    // Day 10 window: only the 0.1 failure — a cumulative mean would show 0.5.
    expect(timeline[2].avgConfidence).toBeCloseTo(0.1);
  });

  test('failed experiments participate in the window mean', () => {
    const series = emptySeries();
    series.experiments = [
      {
        createdAt: d('2026-07-01T09:00:00Z'),
        completedAt: d('2026-07-01T10:00:00Z'),
        status: 'completed',
        confidence: 0.8,
      },
      {
        createdAt: d('2026-07-01T11:00:00Z'),
        completedAt: d('2026-07-01T12:00:00Z'),
        status: 'failed',
        confidence: 0.2,
      },
    ];
    const timeline = computeGrowthTimeline(['2026-07-01'], series);
    expect(timeline[0].avgConfidence).toBeCloseTo(0.5);
  });

  test('non-terminal (running) experiments are excluded from the confidence window', () => {
    const series = emptySeries();
    series.experiments = [
      {
        createdAt: d('2026-07-01T09:00:00Z'),
        completedAt: null,
        status: 'running',
        confidence: 0.5,
      },
    ];
    const timeline = computeGrowthTimeline(['2026-07-01'], series);
    expect(timeline[0].avgConfidence).toBe(0);
    expect(timeline[0].successRate).toBe(0);
  });
});
