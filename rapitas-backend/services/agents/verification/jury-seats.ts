/**
 * jury-seats
 *
 * Seats of the two-reviewer jury, defined by ROLE and TIER only, and their
 * resolution to a concrete provider/model on this host. Not responsible for
 * asking the seats or deciding the review.
 *
 * Resolution is recomputed for every review from "the vendors usable right
 * now × the model tier table × the seat requirements" (seat-planner.ts,
 * 追補5). The requirements never move: a seat that cannot be filled at its
 * floor is returned as UNMET (and recorded by the caller), never quietly
 * filled by a lower tier.
 */
import { toCliModelAlias } from '../../../utils/ai-client/cli-model-alias';
import { getAuxAiMode } from '../../../utils/ai-client';
import type { AIProvider } from '../../../utils/ai-client/types';
import {
  executorRefOf,
  planSeats,
  type PlannedSeat,
  type SeatIndependence,
  type SeatPlan,
  type SeatRequirement,
} from '../../ai/model-tier-table/seat-planner';
import {
  seatableEntries,
  vendorOfProvider,
  type ModelVendor,
} from '../../ai/model-tier-table/tier-table';
import {
  usableVendorsAmong,
  type VendorAvailability,
} from '../../ai/model-tier-table/usable-vendors';
import type { JurorSpec } from './jury-panel';
import type { SeatId, SeatRole, SeatTier } from './jury-seat-types';

/** One seat as defined (no vendor). */
export interface SeatDefinition {
  seatId: SeatId;
  role: SeatRole;
  tier: SeatTier;
}

/** A defined seat resolved to who actually sits in it. */
export type SeatAssignment = SeatDefinition &
  JurorSpec & {
    /**
     * The model the call will actually run on (CLI: the `--model` alias), the
     * identity two seats are compared on for independence.
     */
    resolvedModel: string;
    /** How this seat's independence is secured (別系統 or 文脈分離＋反証レンズ). */
    independence?: SeatIndependence;
    /**
     * Set when no usable model meets the seat's requirement. The seat is then
     * not asked; it is recorded as unanswered so the review is never read as
     * having had this opinion.
     */
    unmet?: string;
  };

/**
 * The default jury: two blind reviewers and one verifier.
 *
 * Reviewer-2 is one tier below reviewer-1 so the two opinions come from
 * different models (two calls to the same model are not independent — see
 * two-seat-review.ts's same_model rule). Neither sits below `standard`, per
 * "a reviewer is at least as capable as the usual implementer". The verifier
 * decides disputes, so it takes the top tier. Each floor is further raised to
 * the executor's tier when the executor is known.
 */
export const DEFAULT_SEATS: readonly SeatDefinition[] = [
  { seatId: 'reviewer-1', role: 'reviewer', tier: 'premium' },
  { seatId: 'reviewer-2', role: 'reviewer', tier: 'standard' },
  { seatId: 'verifier', role: 'verifier', tier: 'premium' },
];

/**
 * Independence order per seat (別系統 ＞ 文脈分離＋反証レンズ): reviewer-1 away
 * from the executor; reviewer-2 away from reviewer-1 first, so the two blind
 * opinions are not one family's view counted twice, then from the executor.
 */
const INDEPENDENT_OF: Record<SeatId, readonly string[]> = {
  'reviewer-1': ['executor'],
  'reviewer-2': ['reviewer-1', 'executor'],
  verifier: ['executor'],
};

/** The jury's seats as planner requirements. */
export const JURY_SEAT_REQUIREMENTS: readonly SeatRequirement[] = DEFAULT_SEATS.map((d) => ({
  seatId: d.seatId,
  role: d.role,
  minTier: d.tier,
  independentOf: INDEPENDENT_OF[d.seatId],
}));

const API_PROVIDERS: AIProvider[] = ['claude', 'gemini', 'chatgpt'];

const PROVIDER_OF_VENDOR: Record<ModelVendor, AIProvider> = {
  anthropic: 'claude',
  openai: 'chatgpt',
  google: 'gemini',
};

/** Result of seat resolution for one review. */
export interface JurySeating {
  reviewers: [SeatAssignment, SeatAssignment];
  verifier: SeatAssignment;
  /** The planner's full answer: mode, per-seat independence, shortfalls. */
  plan: SeatPlan;
  /** Route vendors left out because they are temporarily unusable. */
  unavailable: VendorAvailability['unavailable'];
}

function seated(def: SeatDefinition, planned: PlannedSeat, cli: boolean): SeatAssignment {
  const { entry } = planned;
  if (cli) {
    const alias = entry.cliAlias ?? toCliModelAlias(entry.modelId);
    return {
      ...def,
      provider: 'claude',
      model: entry.modelId,
      label: `claude:${alias}`,
      resolvedModel: toCliModelAlias(entry.modelId),
      independence: planned.independence,
    };
  }
  const provider = PROVIDER_OF_VENDOR[entry.vendor];
  return {
    ...def,
    provider,
    model: entry.modelId,
    label: `${provider}:${entry.modelId}`,
    resolvedModel: entry.modelId,
    independence: planned.independence,
  };
}

function unmetSeat(def: SeatDefinition, reason: string): SeatAssignment {
  // A per-seat identity, so two unmet seats never compare as one model.
  const id = `unmet:${def.seatId}`;
  return { ...def, provider: 'claude', model: '', label: id, resolvedModel: id, unmet: reason };
}

/**
 * Resolve the seats for one review.
 *
 * `RAPITAS_JURY_MODELS` (comma separated, CLI host) still overrides the models
 * by seat order: reviewer-1, reviewer-2, verifier; a seat with no entry keeps
 * its planned model. An explicit override is the operator's choice and is not
 * re-checked against the table.
 *
 * @param args.auxMode - Auxiliary AI mode (default: current) / 補助AIのモード
 * @param args.providers - Reachable providers for API mode / APIモードのプロバイダ
 * @param args.executorModel - Model that implemented the change, if known / 実行役のモデル
 * @returns Seats, the plan behind them, and unusable vendors / 席の割り当て
 */
export function assignSeats(
  args: {
    auxMode?: ReturnType<typeof getAuxAiMode>;
    providers?: AIProvider[];
    executorModel?: string | null;
  } = {},
): JurySeating {
  const auxMode = args.auxMode ?? getAuxAiMode();
  const cli = auxMode === 'cli';
  // NOTE: In CLI aux mode every juror call goes through the Claude Code CLI
  // (sendAIMessage ignores the provider there), so Anthropic is the only
  // vendor this host can seat, whatever else is configured.
  const routeVendors: ModelVendor[] = cli
    ? ['anthropic']
    : (args.providers?.length ? args.providers : API_PROVIDERS)
        .map((p) => vendorOfProvider(p))
        .filter((v): v is ModelVendor => v !== null);
  const availability = usableVendorsAmong(routeVendors);
  const candidates = seatableEntries({ vendors: availability.usable, cliOnly: cli });
  // Keep the route's vendor order as the planner's last tiebreak.
  candidates.sort(
    (a, b) => availability.usable.indexOf(a.vendor) - availability.usable.indexOf(b.vendor),
  );
  const plan = planSeats({
    requirements: JURY_SEAT_REQUIREMENTS,
    candidates,
    executor: executorRefOf(args.executorModel),
  });

  const overrides = cli
    ? (process.env.RAPITAS_JURY_MODELS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const resolve = (def: SeatDefinition, i: number): SeatAssignment => {
    const override = overrides[i];
    if (override) {
      return {
        ...def,
        provider: 'claude',
        model: override,
        label: `claude:${toCliModelAlias(override)}`,
        resolvedModel: toCliModelAlias(override),
      };
    }
    const planned = plan.seats.find((s) => s.seatId === def.seatId);
    if (planned) return seated(def, planned, cli);
    const shortfall = plan.shortfalls.find((s) => s.seatId === def.seatId);
    return unmetSeat(def, shortfall?.reason ?? '席の要件を満たすモデルがない');
  };
  const [r1, r2, v] = DEFAULT_SEATS;
  return {
    reviewers: [resolve(r1, 0), resolve(r2, 1)],
    verifier: resolve(v, 2),
    plan,
    unavailable: availability.unavailable,
  };
}
