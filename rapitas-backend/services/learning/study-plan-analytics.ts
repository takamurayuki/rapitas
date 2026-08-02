/**
 * study-plan-analytics
 *
 * Pure computations for the learning-roadmap analytics, grounded in
 * evidence-based study science: distributed practice (spacing effect),
 * retrieval practice (testing effect), and consistency/pacing toward a
 * deadline. No database access — callers pass rows in.
 */

/** One day of recorded study (from StudyStreak). */
export interface DailyStudy {
  /** ISO date (yyyy-mm-dd or full ISO). */
  date: string;
  minutes: number;
}

/** The slice of a goal the pace analysis needs. */
export interface PaceGoal {
  id: number;
  type: string;
  title: string;
  deadline: Date | null;
  dailyMinutes: number;
  status: string;
}

/** Aggregate pacing metrics for the active goals. */
export interface StudyPace {
  /** Daily quota being tracked against (max of active goals'). */
  quotaMinutes: number;
  /** Average studied minutes over the last 7 days. */
  avg7d: number;
  /** Share (0-100) of the last 7 days that met the quota. */
  adherence7d: number;
  /** Consecutive days (ending today or yesterday) with any study. */
  streakDays: number;
  /** Share (0-100) of the last 14 days' minutes packed into the top 2 days —
   * high = massed practice (cramming), the opposite of distributed practice. */
  crammingIndex: number | null;
  /** Total minutes over the last 7 / 30 days. */
  total7d: number;
  total30d: number;
}

/** A rule-based recommendation; `technique` names the underlying science. */
export interface StudyRecommendation {
  key: string;
  technique: 'spacing' | 'retrieval' | 'consistency' | 'pacing' | 'none';
  params?: Record<string, string | number>;
}

const DAY_MS = 86_400_000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Sum minutes for the N days ending at `now` (inclusive). */
function windowMinutes(days: DailyStudy[], now: Date, n: number): number[] {
  const byDay = new Map(days.map((d) => [d.date.slice(0, 10), d.minutes]));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(byDay.get(dayKey(new Date(now.getTime() - i * DAY_MS))) ?? 0);
  }
  return out;
}

/**
 * Compute pacing metrics from the study log.
 *
 * @param goals - All goals (only active ones count) / 目標一覧
 * @param days - Daily study minutes / 日別学習時間
 * @param now - Reference time (injectable for tests) / 基準時刻
 * @returns Aggregate pace metrics / ペース指標
 */
export function computeStudyPace(goals: PaceGoal[], days: DailyStudy[], now: Date): StudyPace {
  const active = goals.filter((g) => g.status === 'active');
  const quotaMinutes = active.length > 0 ? Math.max(...active.map((g) => g.dailyMinutes)) : 0;

  const last7 = windowMinutes(days, now, 7);
  const last14 = windowMinutes(days, now, 14);
  const last30 = windowMinutes(days, now, 30);

  const total7d = last7.reduce((a, b) => a + b, 0);
  const total14 = last14.reduce((a, b) => a + b, 0);
  const total30d = last30.reduce((a, b) => a + b, 0);

  const adherence7d =
    quotaMinutes > 0 ? Math.round((last7.filter((m) => m >= quotaMinutes).length / 7) * 100) : 0;

  // Streak: walk back from today; a zero today doesn't break it (the day may
  // not be over yet) but a zero yesterday does.
  let streakDays = 0;
  const back = windowMinutes(days, now, 60).reverse(); // [today, yesterday, ...]
  for (let i = 0; i < back.length; i++) {
    if (back[i] > 0) streakDays++;
    else if (i === 0) continue;
    else break;
  }

  const sorted = [...last14].sort((a, b) => b - a);
  const crammingIndex =
    total14 > 0 ? Math.round(((sorted[0] + (sorted[1] ?? 0)) / total14) * 100) : null;

  return {
    quotaMinutes,
    avg7d: Math.round(total7d / 7),
    adherence7d,
    streakDays,
    crammingIndex,
    total7d,
    total30d,
  };
}

// Conservative thresholds — advice only fires on meaningful evidence.
const CRAMMING_THRESHOLD = 60; // % of 14d minutes in top-2 days
const LOW_ADHERENCE = 40; // %
const DEADLINE_SOON_DAYS = 14;
const MIN_DUE_FOR_RETRIEVAL = 10;

/**
 * Build evidence-based study recommendations.
 *
 * @param goals - All goals / 目標一覧
 * @param pace - Output of computeStudyPace / ペース指標
 * @param vocabDueCount - Vocabulary cards currently due / 復習期限超過カード数
 * @param now - Reference time / 基準時刻
 * @returns Recommendations tagged with their technique / 提案リスト
 */
export function buildStudyRecommendations(
  goals: PaceGoal[],
  pace: StudyPace,
  vocabDueCount: number,
  now: Date,
): StudyRecommendation[] {
  const recs: StudyRecommendation[] = [];
  const active = goals.filter((g) => g.status === 'active');

  if (active.length === 0) {
    return [{ key: 'noActiveGoals', technique: 'none' }];
  }

  // Spacing effect: the same total time distributed over more days beats
  // massed sessions for long-term retention (Cepeda et al., 2006).
  if (pace.crammingIndex != null && pace.total30d > 0 && pace.crammingIndex >= CRAMMING_THRESHOLD) {
    recs.push({ key: 'massedPractice', technique: 'spacing', params: { pct: pace.crammingIndex } });
  }

  // Testing effect: retrieval beats re-reading (Roediger & Karpicke, 2006) —
  // an overdue vocab queue is unused retrieval practice waiting to happen.
  if (vocabDueCount >= MIN_DUE_FOR_RETRIEVAL) {
    recs.push({
      key: 'retrievalBacklog',
      technique: 'retrieval',
      params: { count: vocabDueCount },
    });
  }

  // Consistency: streaks + quota adherence proxy habitual distributed practice.
  if (pace.quotaMinutes > 0 && pace.adherence7d < LOW_ADHERENCE) {
    recs.push({
      key: 'lowAdherence',
      technique: 'consistency',
      params: { adherence: pace.adherence7d, quota: pace.quotaMinutes },
    });
  }

  // Pacing toward exam deadlines: falling behind close to the date pushes
  // toward cramming — surface it while distributed practice is still possible.
  for (const g of active) {
    if (!g.deadline) continue;
    const daysLeft = Math.ceil((g.deadline.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft >= 0 && daysLeft <= DEADLINE_SOON_DAYS && pace.avg7d < pace.quotaMinutes) {
      recs.push({
        key: 'deadlineAtRisk',
        technique: 'pacing',
        params: { title: g.title, daysLeft, avg: pace.avg7d, quota: pace.quotaMinutes },
      });
    }
  }

  if (recs.length === 0) {
    recs.push({ key: 'onTrack', technique: 'none', params: { streak: pace.streakDays } });
  }
  return recs;
}
