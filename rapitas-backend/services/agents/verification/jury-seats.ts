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
import type { ConfiguredVendors } from '../../ai/model-tier-table/configured-vendors';
import {
  executorRefOf,
  planSeats,
  type ExecutorRef,
  type PlannedSeat,
  type SeatIndependence,
  type SeatPlan,
  type SeatRequirement,
} from '../../ai/model-tier-table/seat-planner';
import {
  cliRouteOf,
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
     * The model the call will actually run on (Claude CLI: the `--model`
     * alias; Codex CLI: the `-m` id), the identity two seats are compared on
     * for independence.
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
 * the executor's tier; an executor no run record confirms counts as premium.
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
  /** Vendors left out: not configured on this host, or in cooldown. */
  unavailable: VendorAvailability['unavailable'];
}

function seated(def: SeatDefinition, planned: PlannedSeat, cli: boolean): SeatAssignment {
  const { entry } = planned;
  if (cli) {
    // NOTE: The CLI route follows the row's VENDOR (routing2b). This used to
    // send every row through the Claude CLI, so an OpenAI row would have been
    // recorded — and asked — as `haiku` (toCliModelAlias maps unknown ids
    // there), and astra/sol would have compared as one model.
    const route = cliRouteOf(entry);
    if (route === 'codex' && entry.codexCliModel) {
      return {
        ...def,
        provider: 'chatgpt',
        cliRoute: 'codex',
        model: entry.codexCliModel,
        label: `codex:${entry.codexCliModel}`,
        resolvedModel: entry.codexCliModel,
        independence: planned.independence,
      };
    }
    if (route !== 'claude') {
      // seatableEntries({cliOnly}) never offers such a row; refuse rather
      // than guess a route.
      return unmetSeat(def, `${entry.modelId} に CLI の経路がない`);
    }
    const alias = entry.cliAlias ?? toCliModelAlias(entry.modelId);
    return {
      ...def,
      provider: 'claude',
      cliRoute: 'claude',
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

/** Seat ids in RAPITAS_JURY_MODELS order. */
const OVERRIDE_ORDER: readonly SeatId[] = ['reviewer-1', 'reviewer-2', 'verifier'];

function readOverrides(): Record<string, string> {
  const models = (process.env.RAPITAS_JURY_MODELS ?? '').split(',').map((s) => s.trim());
  const out: Record<string, string> = {};
  OVERRIDE_ORDER.forEach((seatId, i) => {
    if (models[i]) out[seatId] = models[i];
  });
  return out;
}

/**
 * Resolve the seats for one review.
 *
 * `vendors` is the host's configured set (configured-vendors.ts); cooldowns
 * are layered on here. Without it nothing is configured and every seat is
 * unmet — a caller that forgets it must not get a jury of vendors it never
 * checked. `providers` is a shorthand that declares those providers
 * configured (tests, callers that already checked).
 *
 * `RAPITAS_JURY_MODELS` (comma separated, CLI host) overrides the models by
 * seat order: reviewer-1, reviewer-2, verifier. OpenAI ids are accepted when
 * the Codex CLI is configured. An override is held to the same
 * requirements as the planner's choice (floor ≥ executor, review suitability,
 * usable vendor and CLI route); one that fails leaves its seat unmet. The plan
 * returned is what actually sits, overrides included.
 *
 * @param args.auxMode - Auxiliary AI mode (default: current) / 補助AIのモード
 * @param args.vendors - Vendors configured on this host / 設定済みのベンダー
 * @param args.providers - Shorthand: these providers are configured / 設定済みとみなすプロバイダ
 * @param args.executor - The executor, resolved from its runs / 実行役
 * @param args.executorModel - Shorthand for `executor` from a model id / 実行役のモデル
 * @returns Seats, the plan behind them, and unusable vendors / 席の割り当て
 */
export function assignSeats(
  args: {
    auxMode?: ReturnType<typeof getAuxAiMode>;
    vendors?: ConfiguredVendors;
    providers?: AIProvider[];
    executor?: ExecutorRef;
    executorModel?: string | null;
  } = {},
): JurySeating {
  const auxMode = args.auxMode ?? getAuxAiMode();
  const cli = auxMode === 'cli';
  const declared: ConfiguredVendors = args.vendors ?? {
    configured: (args.providers ?? [])
      .map((p) => vendorOfProvider(p))
      .filter((v): v is ModelVendor => v !== null),
    unconfigured: [],
  };
  // NOTE: The CLI host used to keep Anthropic only (every call went to the
  // Claude CLI). Since routing2b each seat names its CLI (cliRoute), so any
  // configured vendor with a CLI route may sit; seatableEntries({cliOnly})
  // drops rows no CLI reaches (Google, Fable).
  const availability = usableVendorsAmong(declared.configured, declared.unconfigured);
  const candidates = seatableEntries({ vendors: availability.usable, cliOnly: cli });
  // Keep the route's vendor order as the planner's last tiebreak.
  candidates.sort(
    (a, b) => availability.usable.indexOf(a.vendor) - availability.usable.indexOf(b.vendor),
  );
  const plan = planSeats({
    requirements: JURY_SEAT_REQUIREMENTS,
    candidates,
    executor: args.executor ?? executorRefOf(args.executorModel),
    overrides: cli ? readOverrides() : undefined,
  });

  const resolve = (def: SeatDefinition): SeatAssignment => {
    const planned = plan.seats.find((s) => s.seatId === def.seatId);
    if (planned) return seated(def, planned, cli);
    const shortfall = plan.shortfalls.find((s) => s.seatId === def.seatId);
    return unmetSeat(def, shortfall?.reason ?? '席の要件を満たすモデルがない');
  };
  const [r1, r2, v] = DEFAULT_SEATS;
  return {
    reviewers: [resolve(r1), resolve(r2)],
    verifier: resolve(v),
    plan,
    unavailable: availability.unavailable,
  };
}
