/**
 * sample-gate
 *
 * The one place that decides whether a weekly rate or median has enough
 * denominator to assert anything. Shared by the improvement digest and the
 * detail charts, so the same week is never qualified in one panel and stated
 * as fact in another. Not responsible for formatting or rendering.
 */

/**
 * A value whose denominator is below this is treated as "no data".
 *
 * Measured 2026-09-06: a 1/1 plan pass and a 0/3 defect recurrence both read as
 * a perfect score and lifted that week's improvement index from 83 to 86.
 *
 * NOTE: The first-pass card on /agents/metrics gates at a stricter 12, taken
 * from this repo's determinism audit ("conclusions flip below 12 samples").
 * The two are deliberately separate: this guards a mean folded from six rates,
 * where a thin outlier is diluted, while that guards a single headline figure.
 */
export const MIN_RATE_SAMPLE = 5;

/**
 * The value, or null when its denominator is too small to assert anything.
 * Applies to rates and to medians alike — a 590-minute median over two tasks
 * is no more trustworthy than a 100% pass over one.
 *
 * @param value - Measured rate or median; already null when unmeasured / 実測値
 * @param sample - Denominator the value was computed over / 分母
 * @returns The value, or null below the threshold / 値（標本不足ならnull）
 */
export function gatedBySample(value: number | null, sample: number): number | null {
  return sample >= MIN_RATE_SAMPLE ? value : null;
}
