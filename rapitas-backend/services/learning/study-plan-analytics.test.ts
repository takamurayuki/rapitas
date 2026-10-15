/**
 * study-plan-analytics unit tests — pacing metrics and recommendations.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildStudyRecommendations,
  computeStudyPace,
  localDayKey,
  type DailyStudy,
  type PaceGoal,
  type SessionSlice,
  type StudySignals,
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

// Streak rows carry LOCAL day keys — mirror the route's localDayKey mapping.
const day = (offset: number, minutes: number): DailyStudy => ({
  date: localDayKey(new Date(NOW.getTime() - offset * 86_400_000)),
  minutes,
});

const session = (offsetDays: number, minutes: number, goalId: number | null): SessionSlice => ({
  goalId,
  minutes,
  studiedAt: new Date(NOW.getTime() - offsetDays * 86_400_000),
});

/** Signals with quiet defaults so each test flips exactly one rule. */
const signals = (over: Partial<StudySignals> = {}): StudySignals => ({
  vocabDueCount: 0,
  sessions: [],
  inProgressTaskCount: 0,
  ...over,
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
    expect(pace.todayMinutes).toBe(60);
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
    const recs = buildStudyRecommendations([goal({})], pace, signals(), NOW);
    expect(recs.some((r) => r.key === 'massedPractice' && r.technique === 'spacing')).toBe(true);
  });

  test('復習バックログには想起練習(retrieval)を提案する', () => {
    const pace = computeStudyPace([goal({})], [day(0, 60)], NOW);
    const recs = buildStudyRecommendations([goal({})], pace, signals({ vocabDueCount: 25 }), NOW);
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
    const recs = buildStudyRecommendations([exam], pace, signals(), NOW);
    expect(recs.some((r) => r.key === 'deadlineAtRisk' && r.technique === 'pacing')).toBe(true);
  });

  test('今日未学習かつ進行中タスクがあればツァイガルニク再開を提案する', () => {
    const pace = computeStudyPace([goal({})], [day(1, 60), day(2, 60)], NOW);
    const recs = buildStudyRecommendations(
      [goal({})],
      pace,
      signals({ inProgressTaskCount: 2 }),
      NOW,
    );
    const rec = recs.find((r) => r.key === 'zeigarnikResume');
    expect(rec?.technique).toBe('zeigarnik');
    expect(rec?.params?.count).toBe(2);
  });

  test('今日すでに学習していればツァイガルニク再開は出さない', () => {
    const pace = computeStudyPace([goal({})], [day(0, 30)], NOW);
    const recs = buildStudyRecommendations(
      [goal({})],
      pace,
      signals({ inProgressTaskCount: 2 }),
      NOW,
    );
    expect(recs.some((r) => r.key === 'zeigarnikResume')).toBe(false);
  });

  test('複数目標で1目標に学習が偏ると交互学習(interleaving)を提案する', () => {
    const goals = [goal({ id: 1, title: 'TOEIC' }), goal({ id: 2, title: '競プロ' })];
    const pace = computeStudyPace(goals, [day(0, 60)], NOW);
    const recs = buildStudyRecommendations(
      goals,
      pace,
      signals({
        sessions: [session(1, 60, 1), session(2, 60, 1), session(3, 60, 1), session(4, 5, 2)],
      }),
      NOW,
    );
    const rec = recs.find((r) => r.key === 'blockedPractice');
    expect(rec?.technique).toBe('interleaving');
    expect(rec?.params?.title).toBe('TOEIC');
  });

  test('目標が1つだけなら交互学習は提案しない', () => {
    const pace = computeStudyPace([goal({})], [day(0, 60)], NOW);
    const recs = buildStudyRecommendations(
      [goal({})],
      pace,
      signals({ sessions: [session(1, 200, 1), session(2, 200, 1)] }),
      NOW,
    );
    expect(recs.some((r) => r.key === 'blockedPractice')).toBe(false);
  });

  test('1回あたりの学習が長すぎるとセッション分割(chunking)を提案する', () => {
    const pace = computeStudyPace([goal({})], [day(0, 60)], NOW);
    const recs = buildStudyRecommendations(
      [goal({})],
      pace,
      signals({ sessions: [session(1, 120, null), session(3, 100, null), session(5, 110, null)] }),
      NOW,
    );
    const rec = recs.find((r) => r.key === 'longSessions');
    expect(rec?.technique).toBe('chunking');
    expect(rec?.params?.avg).toBe(110);
  });

  test('順調なら onTrack のみ', () => {
    const days = Array.from({ length: 14 }, (_, i) => day(i, 60));
    const pace = computeStudyPace([goal({})], days, NOW);
    const recs = buildStudyRecommendations([goal({})], pace, signals(), NOW);
    expect(recs).toEqual([
      { key: 'onTrack', technique: 'none', params: { streak: pace.streakDays } },
    ]);
  });

  test('アクティブ目標が無ければ noActiveGoals', () => {
    const pace = computeStudyPace([], [], NOW);
    expect(buildStudyRecommendations([], pace, signals(), NOW)).toEqual([
      { key: 'noActiveGoals', technique: 'none' },
    ]);
  });
});
