/**
 * improvement-digest
 *
 * Pure aggregation behind the "改善ダイジェスト" banner on /agents/growth: folds
 * the growth ledger's and retro KPI ledger's weekly RATES into one 0-100
 * improvement index per week, a verdict for the latest week versus the one
 * before, and the per-metric diffs that explain it. Counts and durations are
 * deliberately NOT folded into the index (they have no natural 0-100 scale);
 * they are surfaced as tiles beside it. Not responsible for rendering.
 */
import type { GrowthLedgerWindow, ImprovementDirection, RetroKpiWindow } from '../types';
import type { KpiDiff } from './retro-kpi-points';

/** Rate metric folded into the index: 0-1, direction says which way is good. */
export interface DigestRateMetric {
  key:
    | 'autonomy'
    | 'researchFirstPass'
    | 'planFirstPass'
    | 'defectRecurrence'
    | 'kbQuality'
    | 'repairRate';
  direction: ImprovementDirection;
  /** Newest value (0-1) or null when the window has no sample. */
  current: number | null;
  /** Second-newest value (0-1) or null. */
  previous: number | null;
}

/** Count/duration metric shown as a tile beside the index. */
export interface DigestTileMetric {
  key: 'autonomousCompleted' | 'autoMerged' | 'repairRate';
  direction: ImprovementDirection;
  valueFormat: 'count' | 'percent';
  current: number | null;
  previous: number | null;
}

export type DigestVerdict = 'improving' | 'flat' | 'worsening' | 'insufficient';

export interface ImprovementDigest {
  /** Index per week, oldest first, null where no rate had a sample. */
  indexSeries: Array<{ weekLabel: string; index: number | null }>;
  latestIndex: number | null;
  previousIndex: number | null;
  verdict: DigestVerdict;
  rates: DigestRateMetric[];
  tiles: DigestTileMetric[];
}

/** Index movement (points) below which a week counts as flat. */
export const FLAT_BAND_POINTS = 2;

const rateOf = (v: number | null, direction: ImprovementDirection): number | null =>
  v === null ? null : direction === 'lower_is_better' ? 1 - v : v;

/**
 * Rate metrics of one week, in display order.
 *
 * @param g - Growth ledger window / 成長台帳の週
 * @param r - Retro KPI window of the same week, if present / 同じ週の KPI 台帳
 * @returns Rate values with their improvement direction / 率指標
 */
export function weekRates(
  g: GrowthLedgerWindow,
  r: RetroKpiWindow | undefined,
): Array<{ key: DigestRateMetric['key']; direction: ImprovementDirection; value: number | null }> {
  return [
    { key: 'autonomy', direction: 'higher_is_better', value: g.autonomy.rate },
    {
      key: 'researchFirstPass',
      direction: 'higher_is_better',
      value: g.criticFirstPass.research.rate,
    },
    { key: 'planFirstPass', direction: 'higher_is_better', value: g.criticFirstPass.plan.rate },
    { key: 'defectRecurrence', direction: 'lower_is_better', value: g.defectRecurrence.rate },
    { key: 'kbQuality', direction: 'higher_is_better', value: g.kbQuality.rate },
    { key: 'repairRate', direction: 'lower_is_better', value: r?.repairRate.rate ?? null },
  ];
}

/**
 * Improvement index of one week: mean over the available rates of "how good"
 * each is (0-100), lower-is-better rates inverted. Null when nothing measured.
 *
 * @param g - Growth ledger window / 成長台帳の週
 * @param r - Retro KPI window of the same week / 同じ週の KPI 台帳
 * @returns 0-100 index or null / 改善指数
 */
export function improvementIndex(
  g: GrowthLedgerWindow,
  r: RetroKpiWindow | undefined,
): number | null {
  const goods = weekRates(g, r)
    .map((m) => rateOf(m.value, m.direction))
    .filter((v): v is number => v !== null);
  if (goods.length === 0) return null;
  return Math.round((goods.reduce((a, b) => a + b, 0) / goods.length) * 100);
}

/**
 * Decide the headline from the two newest weeks.
 *
 * @param latest - Newest index / 最新週の指数
 * @param previous - Second-newest index / 前週の指数
 * @returns Verdict / 判定
 */
export function decideVerdict(latest: number | null, previous: number | null): DigestVerdict {
  if (latest === null || previous === null) return 'insufficient';
  const delta = latest - previous;
  if (delta >= FLAT_BAND_POINTS) return 'improving';
  if (delta <= -FLAT_BAND_POINTS) return 'worsening';
  return 'flat';
}

const dayKey = (iso: string): string => iso.slice(0, 10);

/**
 * Build the digest from both ledgers (newest window first, as the APIs return).
 *
 * @param growth - Growth ledger windows / 成長台帳
 * @param retro - Retro KPI windows / KPI 台帳
 * @param formatWeekLabel - x-axis label for a window's `to` date / 週ラベル整形
 * @returns Digest ready for rendering / ダイジェスト
 */
export function computeImprovementDigest(
  growth: GrowthLedgerWindow[],
  retro: RetroKpiWindow[],
  formatWeekLabel: (iso: string) => string,
): ImprovementDigest {
  const retroByDay = new Map(retro.map((w) => [dayKey(w.to), w]));
  const pairs = growth.map((g) => ({ g, r: retroByDay.get(dayKey(g.to)) }));
  const indexes = pairs.map(({ g, r }) => improvementIndex(g, r));
  const latestIndex = indexes[0] ?? null;
  const previousIndex = indexes[1] ?? null;
  const [cur, prev] = pairs;

  const rates: DigestRateMetric[] = cur
    ? weekRates(cur.g, cur.r).map((m, i) => ({
        key: m.key,
        direction: m.direction,
        current: m.value,
        previous: prev ? (weekRates(prev.g, prev.r)[i]?.value ?? null) : null,
      }))
    : [];

  const tile = (
    key: DigestTileMetric['key'],
    direction: ImprovementDirection,
    valueFormat: DigestTileMetric['valueFormat'],
    pick: (g: GrowthLedgerWindow, r: RetroKpiWindow | undefined) => number | null,
  ): DigestTileMetric => ({
    key,
    direction,
    valueFormat,
    current: cur ? pick(cur.g, cur.r) : null,
    previous: prev ? pick(prev.g, prev.r) : null,
  });
  // Three numbers only — "did it work unattended, did it ship, did it need
  // fixing". Everything else lives in the collapsed detail charts.
  const tiles: DigestTileMetric[] = [
    tile('autonomousCompleted', 'higher_is_better', 'count', (g) => g.autonomy.autonomous),
    tile('autoMerged', 'higher_is_better', 'count', (_g, r) => r?.autoMerged ?? null),
    tile('repairRate', 'lower_is_better', 'percent', (_g, r) => r?.repairRate.rate ?? null),
  ];

  return {
    indexSeries: [...pairs].reverse().map(({ g }, i) => ({
      weekLabel: formatWeekLabel(g.to),
      index: indexes[pairs.length - 1 - i] ?? null,
    })),
    latestIndex,
    previousIndex,
    verdict: decideVerdict(latestIndex, previousIndex),
    rates,
    tiles,
  };
}

/**
 * Adapt a digest metric to the KpiDiffBadge contract.
 *
 * @param m - Rate or tile metric / 指標
 * @returns KpiDiff for the badge / バッジ用差分
 */
export function toKpiDiff(m: {
  current: number | null;
  previous: number | null;
  direction: ImprovementDirection;
}): KpiDiff {
  return { currentValue: m.current, previousValue: m.previous, direction: m.direction };
}
