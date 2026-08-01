/**
 * vocab-analytics
 *
 * Pure computations for the vocabulary learning analytics: the learner's
 * personal retention curve (vs the classic Ebbinghaus reference), estimated
 * memory stability, time-of-day performance, and rule-based study
 * recommendations. No database access — callers pass review-log rows.
 */

/** The minimal log shape the analytics need. */
export interface ReviewLogRow {
  cardId: number;
  grade: string; // again | good | easy
  elapsedDays: number;
  repetitions: number;
  reviewedAt: Date;
}

/** One point on the retention curve. */
export interface RetentionBucket {
  /** Bucket label key: e.g. 'd1' (under 1 day). */
  key: string;
  /** Midpoint in days, for plotting. */
  midDays: number;
  /** Recall rate 0-100 (%), null when no samples. */
  rate: number | null;
  /** Ebbinghaus reference retention 0-100 (%) at the midpoint. */
  reference: number;
  samples: number;
}

/** Recall rate by time of day. */
export interface HourBucket {
  key: 'morning' | 'daytime' | 'evening' | 'night';
  rate: number | null;
  samples: number;
}

/** A rule-based recommendation, translated on the frontend. */
export interface StudyRecommendation {
  key: string;
  params?: Record<string, string | number>;
}

// Elapsed-day buckets for the curve: (0,1], (1,3], (3,7], (7,14], (14,30], 30+
const CURVE_BUCKETS: Array<{ key: string; min: number; max: number; midDays: number }> = [
  { key: 'd1', min: 0, max: 1, midDays: 0.5 },
  { key: 'd3', min: 1, max: 3, midDays: 2 },
  { key: 'd7', min: 3, max: 7, midDays: 5 },
  { key: 'd14', min: 7, max: 14, midDays: 10 },
  { key: 'd30', min: 14, max: 30, midDays: 22 },
  { key: 'd30plus', min: 30, max: Infinity, midDays: 45 },
];

/**
 * Classic Ebbinghaus (1885) retention fit: b = 100·k / ((log10 t)^c + k)
 * with k=1.84, c=1.25, t in MINUTES. Reproduces the textbook points
 * (~58% at 20min, ~33% at 1 day, ~21% at 31 days).
 *
 * @param days - Elapsed time in days / 経過日数
 * @returns Retention percentage 0-100 / 想定保持率
 */
export function ebbinghausRetention(days: number): number {
  const minutes = Math.max(1.5, days * 24 * 60);
  const k = 1.84;
  const c = 1.25;
  return Math.round(((100 * k) / (Math.pow(Math.log10(minutes), c) + k)) * 10) / 10;
}

/** Reviews that measure RETENTION: the card had been learned before. */
const retentionLogs = (logs: ReviewLogRow[]) => logs.filter((l) => l.repetitions > 0);

const isRecalled = (l: ReviewLogRow) => l.grade !== 'again';

/**
 * Bucket recall rate by elapsed time — the learner's personal forgetting curve.
 *
 * @param logs - Review log rows / 復習ログ
 * @returns One point per elapsed-time bucket / 経過時間バケット毎の定着率
 */
export function computeRetentionCurve(logs: ReviewLogRow[]): RetentionBucket[] {
  const eligible = retentionLogs(logs);
  return CURVE_BUCKETS.map((b) => {
    const inBucket = eligible.filter((l) => l.elapsedDays > b.min && l.elapsedDays <= b.max);
    const recalled = inBucket.filter(isRecalled).length;
    return {
      key: b.key,
      midDays: b.midDays,
      rate: inBucket.length > 0 ? Math.round((recalled / inBucket.length) * 1000) / 10 : null,
      reference: ebbinghausRetention(b.midDays),
      samples: inBucket.length,
    };
  });
}

/**
 * Estimate personal memory stability S (days) from the curve, assuming
 * R = e^(-t/S): each bucket with 0 < R < 1 yields S = -t / ln(R); average
 * weighted by sample count. Higher S = slower forgetting.
 *
 * @param curve - Output of computeRetentionCurve / 個人忘却曲線
 * @returns Stability in days, or null with too little data / 推定記憶強度(日)
 */
export function estimateStability(curve: RetentionBucket[]): number | null {
  let weighted = 0;
  let weight = 0;
  for (const b of curve) {
    if (b.rate == null || b.samples < 3) continue;
    const r = Math.min(0.99, Math.max(0.01, b.rate / 100));
    weighted += (-b.midDays / Math.log(r)) * b.samples;
    weight += b.samples;
  }
  return weight > 0 ? Math.round((weighted / weight) * 10) / 10 : null;
}

/**
 * Recall rate by time of day (morning 5-11, daytime 11-17, evening 17-23,
 * night 23-5, local time).
 *
 * @param logs - Review log rows / 復習ログ
 * @returns Rate and sample count per period / 時間帯毎の定着率
 */
export function computeHourBuckets(logs: ReviewLogRow[]): HourBucket[] {
  const eligible = retentionLogs(logs);
  const periods: Array<{ key: HourBucket['key']; test: (h: number) => boolean }> = [
    { key: 'morning', test: (h) => h >= 5 && h < 11 },
    { key: 'daytime', test: (h) => h >= 11 && h < 17 },
    { key: 'evening', test: (h) => h >= 17 && h < 23 },
    { key: 'night', test: (h) => h >= 23 || h < 5 },
  ];
  return periods.map(({ key, test }) => {
    const inBucket = eligible.filter((l) => test(l.reviewedAt.getHours()));
    const recalled = inBucket.filter(isRecalled).length;
    return {
      key,
      rate: inBucket.length > 0 ? Math.round((recalled / inBucket.length) * 1000) / 10 : null,
      samples: inBucket.length,
    };
  });
}

// Thresholds for the recommendation rules — deliberately conservative so the
// advice only fires on enough evidence to mean something.
const MIN_LOGS_FOR_ANALYSIS = 20;
const MIN_BUCKET_SAMPLES = 10;
const TIME_DIFF_POINTS = 8;

/**
 * Rule-based study recommendations derived from the aggregates.
 *
 * @param logs - Review log rows / 復習ログ
 * @param curve - Personal retention curve / 個人忘却曲線
 * @param hours - Time-of-day performance / 時間帯別成績
 * @returns Recommendation keys + params (translated by the frontend) / 提案リスト
 */
export function buildRecommendations(
  logs: ReviewLogRow[],
  curve: RetentionBucket[],
  hours: HourBucket[],
): StudyRecommendation[] {
  const recs: StudyRecommendation[] = [];
  const eligible = retentionLogs(logs);

  if (eligible.length < MIN_LOGS_FOR_ANALYSIS) {
    return [{ key: 'notEnoughData', params: { needed: MIN_LOGS_FOR_ANALYSIS } }];
  }

  // Overall retention drives the headline advice.
  const overall = Math.round((eligible.filter(isRecalled).length / eligible.length) * 100);
  if (overall < 70) recs.push({ key: 'lowRetention', params: { rate: overall } });
  else if (overall >= 92) recs.push({ key: 'strongRetention', params: { rate: overall } });

  // Where on the curve does forgetting bite? First bucket whose rate drops
  // below 75% with enough samples marks the personal review horizon.
  const weakBucket = curve.find(
    (b) => b.rate != null && b.samples >= MIN_BUCKET_SAMPLES && b.rate < 75,
  );
  if (weakBucket) recs.push({ key: 'reviewBefore', params: { bucket: weakBucket.key } });

  // Best time of day, only when it beats the worst by a meaningful margin.
  const rated = hours.filter((h) => h.rate != null && h.samples >= MIN_BUCKET_SAMPLES);
  if (rated.length >= 2) {
    const best = rated.reduce((a, b) => ((a.rate ?? 0) >= (b.rate ?? 0) ? a : b));
    const worst = rated.reduce((a, b) => ((a.rate ?? 0) <= (b.rate ?? 0) ? a : b));
    if ((best.rate ?? 0) - (worst.rate ?? 0) >= TIME_DIFF_POINTS) {
      recs.push({ key: 'bestTime', params: { period: best.key, rate: best.rate ?? 0 } });
    }
  }

  if (recs.length === 0) recs.push({ key: 'onTrack', params: { rate: overall } });
  return recs;
}
