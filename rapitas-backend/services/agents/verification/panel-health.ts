/**
 * PanelHealth
 *
 * How many models actually judged, per day. Pure: no database, no clock.
 *
 * The adversarial review collapsed from three voters to one across
 * September 2026 and nothing showed it: the verdict kept arriving, the gate
 * stayed green, and nobody was counting the voters. S1 began recording the
 * seats (`panel` on the `adversarial_review` event); this reads them back.
 *
 * It deliberately produces NO verdict. The first design for this enforced a
 * minimum juror count inside `aggregateJuryVerdicts`, and that would have
 * made the gate weaker rather than stronger: a review where one juror said
 * fail would have been discarded as "not enough voters" and then let
 * through on the low-risk fail-open path. The only behaviour that design
 * changed was a lone fail no longer blocking — the opposite of the point.
 * So the threshold labels, and nothing here decides anything.
 */

/**
 * Smallest panel worth calling a panel.
 *
 * Two, not three: one voter cannot form a majority with anything, and two is
 * the smallest panel where the skeptical tie rule (fails >= passes) has a
 * disagreement to break.
 */
export const DEFAULT_MIN_JUDGED = 2;

/** One review's panel, as the timeline recorded it. */
export interface PanelHealthRow {
  /** Models that returned pass or fail. / 判定を返したモデル数 */
  judged: number;
  /** Seats the panel was built with, before any were rested. / 構成された席数 */
  planned: number;
  at: Date;
}

/** One day's panel health. */
export interface PanelHealthDay {
  date: string;
  reviews: number;
  averageJudged: number;
  underStrength: number;
}

/** Panel health over the window, and per day. */
export interface PanelHealth {
  reviews: number;
  /** Null rather than 0 when there is nothing to average. */
  averageJudged: number | null;
  /** Reviews decided by fewer than `minJudged` models. */
  underStrength: number;
  underStrengthShare: number | null;
  /** Seats built but never asked — a juror rested leaves no verdict row. */
  seatsLost: number;
  minJudged: number;
  byDay: PanelHealthDay[];
}

/**
 * Count how strong the panel was, overall and by day.
 *
 * @param rows - One entry per recorded review / レビュー1件につき1要素
 * @param minJudged - Threshold for "under strength"; labels only / 閾値（表示用）
 * @returns Counts, with shares null rather than 0 when empty / 集計結果
 */
export function summarisePanelHealth(
  rows: readonly PanelHealthRow[],
  minJudged: number = DEFAULT_MIN_JUDGED,
): PanelHealth {
  const days = new Map<string, { reviews: number; judgedTotal: number; underStrength: number }>();
  let judgedTotal = 0;
  let underStrength = 0;
  let seatsLost = 0;

  for (const r of rows) {
    judgedTotal += r.judged;
    const under = r.judged < minJudged;
    if (under) underStrength++;
    seatsLost += Math.max(0, r.planned - r.judged);

    const date = r.at.toISOString().slice(0, 10);
    const d = days.get(date) ?? { reviews: 0, judgedTotal: 0, underStrength: 0 };
    d.reviews++;
    d.judgedTotal += r.judged;
    if (under) d.underStrength++;
    days.set(date, d);
  }

  const reviews = rows.length;
  return {
    reviews,
    averageJudged: reviews === 0 ? null : judgedTotal / reviews,
    underStrength,
    underStrengthShare: reviews === 0 ? null : underStrength / reviews,
    seatsLost,
    minJudged,
    byDay: [...days]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, d]) => ({
        date,
        reviews: d.reviews,
        averageJudged: d.judgedTotal / d.reviews,
        underStrength: d.underStrength,
      })),
  };
}
