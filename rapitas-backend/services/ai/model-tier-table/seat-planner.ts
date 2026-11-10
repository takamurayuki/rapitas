/**
 * model-tier-table/seat-planner
 *
 * Recomputes who sits in each review seat from "the vendors usable right now ×
 * the tier table × the seat requirements" (追補5). The requirements are fixed
 * rules and are never relaxed here; only the assignment changes. Pure — the
 * caller supplies the usable rows, and records/displays the shortfalls this
 * returns. Not responsible for asking the seats.
 */
import { classifyTier } from '../model-discovery/tier-classifier';
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

/** The model that did the work being reviewed, when known. */
export interface ExecutorRef {
  modelId: string;
  vendor: ModelVendor | null;
  tier: AnyTier;
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
}

/** One seat that could not be filled without lowering its requirement. */
export interface SeatShortfall {
  seatId: string;
  role: SeatRequirement['role'];
  requiredTier: TableTier;
  /** Human-readable reason (shown and recorded; 黙って基準を下げない). */
  reason: string;
}

/** The whole assignment. */
export interface SeatPlan {
  /** cross_vendor when ≥2 vendors are usable, single_vendor for one, none for zero. */
  mode: 'cross_vendor' | 'single_vendor' | 'none';
  vendors: ModelVendor[];
  executor: ExecutorRef | null;
  seats: PlannedSeat[];
  shortfalls: SeatShortfall[];
}

/**
 * Describe the executor for planning from a model id.
 *
 * A registered id takes its row's canonical id, vendor and tier (so the alias
 * `sonnet` and `claude-sonnet-5-5` are the same model). An unregistered id
 * keeps the classifier's (already capped) tier and a name-inferred vendor.
 *
 * @param modelId - Model the executor ran, if known / 実行役のモデルID
 * @returns Executor reference, or null when unknown / 不明なら null
 */
export function executorRefOf(modelId: string | null | undefined): ExecutorRef | null {
  if (!modelId?.trim()) return null;
  const entry = findModelEntry(modelId);
  if (entry) return { modelId: entry.modelId, vendor: entry.vendor, tier: entry.tier };
  const m = modelId.toLowerCase();
  const vendor: ModelVendor | null = /claude|opus|sonnet|haiku|fable|mythos/.test(m)
    ? 'anthropic'
    : /gpt|codex|^o\d\b/.test(m)
      ? 'openai'
      : /gemini/.test(m)
        ? 'google'
        : null;
  return { modelId, vendor, tier: classifyTier(modelId) };
}

/**
 * Floor for a seat: its own tier, raised to the executor's — a reviewer is at
 * least as capable as the model whose work it judges. A local (free) executor
 * raises nothing.
 */
function requiredTierOf(req: SeatRequirement, executor: ExecutorRef | null): TableTier {
  if (!executor || executor.tier === 'free') return req.minTier;
  return strongerTier<AnyTier>(req.minTier, executor.tier) as TableTier;
}

function canSit(entry: ModelTierEntry, required: TableTier): boolean {
  return entry.status === 'current' && entry.roles.review && tierAtLeast(entry.tier, required);
}

/** Vendors (and models) of the parties a seat should be independent of. */
function refsOf(
  req: SeatRequirement,
  executor: ExecutorRef | null,
  filled: Map<string, PlannedSeat>,
): Array<{ vendor: ModelVendor | null; modelId: string | null }> {
  return req.independentOf.map((ref) => {
    if (ref === 'executor') {
      return { vendor: executor?.vendor ?? null, modelId: executor?.modelId ?? null };
    }
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
 * Plan the review seats.
 *
 * When `previous` is given (a vendor became unusable mid-task), every previous
 * seat whose model is still usable and still meets its floor is KEPT; only the
 * seats that lost their model are re-chosen, under the same requirements.
 *
 * @param args.requirements - Seats in fill order / 席の要件（埋める順）
 * @param args.candidates - Rows usable right now (vendor available, route reachable) / いま使える行
 * @param args.executor - The model whose work is reviewed, if known / 実行役のモデル
 * @param args.previous - The plan in effect, to keep stable seats / 現行の割り当て
 * @returns The assignment and any unmet seats / 割り当てと未充足の席
 */
export function planSeats(args: {
  requirements: readonly SeatRequirement[];
  candidates: readonly ModelTierEntry[];
  executor: ExecutorRef | null;
  previous?: SeatPlan | null;
}): SeatPlan {
  const { requirements, candidates, executor } = args;
  const vendors = [...new Set(candidates.map((c) => c.vendor))];
  const usableIds = new Set(candidates.map((c) => c.modelId));
  const filled = new Map<string, PlannedSeat>();
  const shortfalls: SeatShortfall[] = [];

  for (const req of requirements) {
    const requiredTier = requiredTierOf(req, executor);
    const refs = refsOf(req, executor, filled);

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
