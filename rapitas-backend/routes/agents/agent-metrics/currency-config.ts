/**
 * Currency Config
 *
 * Single source of truth for the USD→JPY rate used when displaying agent
 * usage costs in yen. Costs are RECORDED in USD (the CLI reports
 * total_cost_usd); conversion happens at display time only.
 */

/** Fallback USD→JPY rate when RAPITAS_USD_JPY_RATE is unset/invalid. */
const DEFAULT_USD_JPY_RATE = 150;

/**
 * Resolve the USD→JPY conversion rate.
 *
 * @returns Rate from env RAPITAS_USD_JPY_RATE, or the default (150) / 換算レート
 */
export function getUsdJpyRate(): number {
  const v = parseFloat(process.env.RAPITAS_USD_JPY_RATE ?? '');
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_USD_JPY_RATE;
}
