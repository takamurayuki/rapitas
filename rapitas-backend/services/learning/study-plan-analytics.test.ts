/**
 * study-plan-analytics unit tests — pacing metrics and recommendations.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildStudyRecommendations,
  computeStudyPace,
  type DailyStudy,
  type PaceGoal,
} from './study-plan-analytics';

const NOW = new Date('2026-08-02T12:00:00Z');

const goal = (over: Partial<PaceGoal>): PaceGoal => ({
  id: 1,
  type: 'skill',
  title: 'goal',
  deadline: null,
  dailyMinutes: 60,
  status: 'active',
  ...over,
});

const day = (offset: number, minutes: number): DailyStudy => ({
  date: new Date(NOW.getTime() - offset * 86_400_000).toISOString(),
  minutes,
});

describe('computeStudyPace', () => {
  test('直近7日の平均・クォータ達成率・連続日数を計算する', () => {
    const days = [day(0, 60), day(1, 60), day(2, 30), day(3, 60), day(4, 0), day(5, 60)];
    const pace = computeStudyPace([goal({})], days, NOW);
    expect(pace.quotaMinutes).toBe(60);
    expect(pace.total7d).toBe(270);
    expect(pace.adherence7d).toBe(Math.round((4 / 7) * 100));
    // today..3日前まで連続、4日前が0で途切れる
    expect(pace.streakDays).toBe(4);
  });

  test('詰め込み指数: 14日の学習が上位2日に集中していると高くなる', () => {
    const crammed = computeStudyPace([goal({})], [day(1, 300), day(2, 280), day(9, 20)], NOW);
    expect(crammed.crammingIndex).toBeGreaterThanOrEqual(90);
    const spread = computeStudyPace(
      [goal({})],
      Array.from({ length: 10 }, (_, i) => day(i, 60)),
      NOW,
    );
    expect(spread.crammingIndex).toBeLessThan(40);
  });
});

describe('buildStudyRecommendations', () => {
  test('詰め込み学習には分散学習(spacing)を提案する', () => {
    const days = [day(1, 300), day(2, 280)];
    const pace = computeStudyPace([goal({})], days, NOW);
    const recs = buildStudyRecommendations([goal({})], pace, 0, NOW);
    expect(recs.some((r) => r.key === 'massedPractice' && r.technique === 'spacing')).toBe(true);
  });

  test('復習バックログには想起練習(retrieval)を提案する', () => {
    const pace = computeStudyPace([goal({})], [day(0, 60)], NOW);
    const recs = buildStudyRecommendations([goal({})], pace, 25, NOW);
    expect(recs.some((r) => r.key === 'retrievalBacklog' && r.technique === 'retrieval')).toBe(
      true,
    );
  });

  test('期限が近くペース不足の試験目標には警告する', () => {
    const exam = goal({
      type: 'exam',
      title: 'TOEIC',
      deadline: new Date(NOW.getTime() + 7 * 86_400_000),
    });
    const pace = computeStudyPace([exam], [day(0, 10)], NOW);
    const recs = buildStudyRecommendations([exam], pace, 0, NOW);
    expect(recs.some((r) => r.key === 'deadlineAtRisk' && r.technique === 'pacing')).toBe(true);
  });

  test('順調なら onTrack のみ', () => {
    const days = Array.from({ length: 14 }, (_, i) => day(i, 60));
    const pace = computeStudyPace([goal({})], days, NOW);
    const recs = buildStudyRecommendations([goal({})], pace, 0, NOW);
    expect(recs).toEqual([
      { key: 'onTrack', technique: 'none', params: { streak: pace.streakDays } },
    ]);
  });

  test('アクティブ目標が無ければ noActiveGoals', () => {
    const pace = computeStudyPace([], [], NOW);
    expect(buildStudyRecommendations([], pace, 0, NOW)).toEqual([
      { key: 'noActiveGoals', technique: 'none' },
    ]);
  });
});
