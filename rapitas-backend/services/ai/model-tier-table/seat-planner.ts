/**
 * model-tier-table/seat-planner
 *
 * Recomputes who sits in each review seat from "the vendors usable right now ×
 * the tier table × the seat requirements" (追補5). The requirements are fixed
 * rules and are never relaxed here; only the assignment changes. Pure — the
 * caller supplies the usable rows, and records/displays the shortfalls this
 * returns. Not responsible for asking the seats.
 */
import { UNVERIFIED_EXECUTOR, type ExecutorRef } from './executor-ref';
import {
  costPer1kOf,
  findModelEntry,
  strongerTier,
  tierAtLeast,
  tierRank,
  type AnyTier,
  type ModelTierEntry,
  type ModelVendor,
  type TableTier,
} from './tier-table';

// NOTE: The executor reference moved to executor-ref.ts (file size); re-exported
// here so existing imports keep working.
export { executorRefOf, UNVERIFIED_EXECUTOR, type ExecutorRef } from './executor-ref';

/** A seat as the organisation defines it — no vendor, no model. */
export interface SeatRequirement {
  seatId: string;
  role: 'reviewer' | 'verifier';
  /** Tier floor of the seat itself. */
  minTier: TableTier;
  /**
   * Whom this seat should be independent of, most important first: other seat
   * ids, or `'executor'` for the model that did the work. A different vendor
   * than each of them is preferred, in this order.
   */
  independentOf: readonly string[];
}

/**
 * How a seat's independence is secured.
 * - cross_vendor: a different model family from everyone it must be independent of.
 * - context_isolation: same family as one of them, so independence rests on a
 *   separate context (blind call) and the adversarial (反証) review lens.
 */
export type SeatIndependence = 'cross_vendor' | 'context_isolation';

/** One seat filled. */
export interface PlannedSeat {
  seatId: string;
  role: SeatRequirement['role'];
  /** Floor actually applied: the seat's own tier, raised to the executor's. */
  requiredTier: TableTier;
  entry: ModelTierEntry;
  independence: SeatIndependence;
  /** True when kept from the previous plan rather than re-chosen. */
  kept: boolean;
  /** True when the operator's override (RAPITAS_JURY_MODELS) chose this model. */
  overridden?: boolean;
}

/** One seat that could not be filled without lowering its requirement. */
export interface SeatShortfall {
  seatId: string;
  role: SeatRequirement['role'];
  requiredTier: TableTier;
  /** Human-readable reason (shown and recorded; 黙って基準を下げない). */
  reason: string;
  /** The operator's override that was refused, when that is the cause. */
  override?: string;
}

/** The whole assignment. */
export interface SeatPlan {
  /** cross_vendor when ≥2 vendors are usable, single_vendor for one, none for zero. */
  mode: 'cross_vendor' | 'single_vendor' | 'none';
  vendors: ModelVendor[];
  executor: ExecutorRef;
  seats: PlannedSeat[];
  shortfalls: SeatShortfall[];
}

/**
 * Floor for a seat: its own tier, raised to the executor's — a reviewer is at
 * least as capable as the model whose work it judges. A local (free) executor
 * raises nothing; an unverified one counts as premium.
 */
function requiredTierOf(req: SeatRequirement, executor: ExecutorRef): TableTier {
  if (executor.tier === 'free') return req.minTier;
  return strongerTier<AnyTier>(req.minTier, executor.tier) as TableTier;
}

function canSit(entry: ModelTierEntry, required: TableTier): boolean {
  return entry.status === 'current' && entry.roles.review && tierAtLeast(entry.tier, required);
}

/** Vendors (and models) of the parties a seat should be independent of. */
function refsOf(
  req: SeatRequirement,
  executor: ExecutorRef,
  filled: Map<string, PlannedSeat>,
): Array<{ vendor: ModelVendor | null; modelId: string | null }> {
  return req.independentOf.map((ref) => {
    if (ref === 'executor') return { vendor: executor.vendor, modelId: executor.modelId };
    const seat = filled.get(ref);
    return { vendor: seat?.entry.vendor ?? null, modelId: seat?.entry.modelId ?? null };
  });
}

/**
 * Lexicographic preference key, smaller is better:
 * vendor differs from each ref in priority order → model differs from each
 * ref in priority order → lowest sufficient tier → cheapest → table order.
 */
function preferenceKey(
  entry: ModelTierEntry,
  refs: ReturnType<typeof refsOf>,
  index: number,
): number[] {
  const sameVendor = refs.map((r) => (r.vendor !== null && r.vendor === entry.vendor ? 1 : 0));
  // Two calls to one model are one opinion (two-seat-review's same_model rule),
  // so a different model is preferred before a cheaper one, in ref order.
  const sameModel = refs.map((r) => (r.modelId !== null && r.modelId === entry.modelId ? 1 : 0));
  return [
    ...sameVendor,
    ...sameModel,
    // Negated: a larger rank is a cheaper tier, and the lowest tier that meets
    // the floor is preferred — the floor is the requirement, not a target.
    -tierRank(entry.tier),
    costPer1kOf(entry) ?? Number.MAX_SAFE_INTEGER,
    index,
  ];
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function independenceOf(entry: ModelTierEntry, refs: ReturnType<typeof refsOf>): SeatIndependence {
  const known = refs.filter((r) => r.vendor !== null);
  return known.every((r) => r.vendor !== entry.vendor) ? 'cross_vendor' : 'context_isolation';
}

/**
 * Why an operator's override may not take a seat, or null when it may. The
 * override is held to the very rules the planner applies (floor, review
 * suitability, usable vendor/route), so an environment variable can never
 * seat what the planner would refuse.
 */
function overrideRefusal(
  override: string,
  required: TableTier,
  usableIds: ReadonlySet<string>,
): { entry: ModelTierEntry | null; reason: string | null } {
  const entry = findModelEntry(override);
  if (!entry) return { entry, reason: `上書き指定 ${override} はティア表に登録がない` };
  if (!usableIds.has(entry.modelId)) {
    return { entry, reason: `上書き指定 ${override} は使えるベンダー・経路にない` };
  }
  if (!canSit(entry, required)) {
    return {
      entry,
      reason: `上書き指定 ${override}（${entry.tier}）は ${required} 以上でレビューに置けるモデルではない`,
    };
  }
  return { entry, reason: null };
}

/**
 * Plan the review seats.
 *
 * When `previous` is given (a vendor became unusable mid-task), every previous
 * seat whose model is still usable and still meets its floor is KEPT; only the
 * seats that lost their model are re-chosen, under the same requirements.
 *
 * An `overrides` entry replaces the choice for its seat only when it meets
 * the same requirements; otherwise the seat is UNMET (never the planner's
 * pick in disguise, never the override below its floor).
 *
 * @param args.requirements - Seats in fill order / 席の要件（埋める順）
 * @param args.candidates - Rows usable right now (vendor available, route reachable) / いま使える行
 * @param args.executor - The model whose work is reviewed, if known / 実行役のモデル
 * @param args.previous - The plan in effect, to keep stable seats / 現行の割り当て
 * @param args.overrides - Operator's per-seat model choice / 運用者の席ごとの指定
 * @returns The assignment and any unmet seats / 割り当てと未充足の席
 */
export function planSeats(args: {
  requirements: readonly SeatRequirement[];
  candidates: readonly ModelTierEntry[];
  executor: ExecutorRef | null;
  previous?: SeatPlan | null;
  overrides?: Readonly<Record<string, string>>;
}): SeatPlan {
  const { requirements, candidates } = args;
  const executor = args.executor ?? UNVERIFIED_EXECUTOR;
  const vendors = [...new Set(candidates.map((c) => c.vendor))];
  const usableIds = new Set(candidates.map((c) => c.modelId));
  const filled = new Map<string, PlannedSeat>();
  const shortfalls: SeatShortfall[] = [];

  for (const req of requirements) {
    const requiredTier = requiredTierOf(req, executor);
    const refs = refsOf(req, executor, filled);

    const override = args.overrides?.[req.seatId];
    if (override) {
      const { entry, reason } = overrideRefusal(override, requiredTier, usableIds);
      if (reason || !entry) {
        shortfalls.push({
          seatId: req.seatId,
          role: req.role,
          requiredTier,
          reason: reason ?? override,
          override,
        });
      } else {
        filled.set(req.seatId, {
          seatId: req.seatId,
          role: req.role,
          requiredTier,
          entry,
          independence: independenceOf(entry, refs),
          kept: false,
          overridden: true,
        });
      }
      continue;
    }

    const prior = args.previous?.seats.find((s) => s.seatId === req.seatId);
    if (prior && usableIds.has(prior.entry.modelId) && canSit(prior.entry, requiredTier)) {
      filled.set(req.seatId, {
        ...prior,
        requiredTier,
        independence: independenceOf(prior.entry, refs),
        kept: true,
      });
      continue;
    }

    const eligible = candidates.filter((c) => canSit(c, requiredTier));
    if (eligible.length === 0) {
      shortfalls.push({
        seatId: req.seatId,
        role: req.role,
        requiredTier,
        reason:
          candidates.length === 0
            ? '使えるベンダーがない'
            : `${requiredTier} 以上でレビューに置けるモデルが、使えるベンダー（${vendors.join(', ')}）にない`,
      });
      continue;
    }
    const ranked = eligible
      .map((entry) => ({ entry, key: preferenceKey(entry, refs, candidates.indexOf(entry)) }))
      .sort((a, b) => compareKeys(a.key, b.key));
    const chosen = ranked[0].entry;
    filled.set(req.seatId, {
      seatId: req.seatId,
      role: req.role,
      requiredTier,
      entry: chosen,
      independence: independenceOf(chosen, refs),
      kept: false,
    });
  }

  return {
    mode: vendors.length >= 2 ? 'cross_vendor' : vendors.length === 1 ? 'single_vendor' : 'none',
    vendors,
    executor,
    seats: requirements
      .map((r) => filled.get(r.seatId))
      .filter((s): s is PlannedSeat => s !== undefined),
    shortfalls,
  };
}
