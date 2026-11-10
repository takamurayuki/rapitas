/**
 * jury-seats
 *
 * Seats of the two-reviewer jury, defined by ROLE and TIER only, and their
 * resolution to a concrete provider/model on this host. Not responsible for
 * asking the seats or deciding the review.
 *
 * NOTE: Vendor-specific seat rebalancing (e.g. "reviewer-2 from a different
 * vendor than the implementer") is the next package's scope. This file only
 * reuses the host mapping jury-panel.ts already had: in Claude-only CLI mode a
 * tier is a Claude model alias; with API providers, the reachable providers
 * are assigned in seat order.
 */
import { getAuxAiMode } from '../../../utils/ai-client';
import { DEFAULT_MODELS, type AIProvider } from '../../../utils/ai-client/types';
import { JURY_MODEL_IDS, type JurorSpec } from './jury-panel';
import type { SeatId, SeatRole, SeatTier } from './jury-seat-types';

/** One seat as defined (no vendor). */
export interface SeatDefinition {
  seatId: SeatId;
  role: SeatRole;
  tier: SeatTier;
}

/** A defined seat resolved to who actually sits in it. */
export type SeatAssignment = SeatDefinition & JurorSpec;

/**
 * The default jury: two blind reviewers and one verifier.
 *
 * Reviewer-2 is one tier below reviewer-1 so the two opinions come from
 * different models (two calls to the same model are not independent — see
 * two-seat-review.ts's same_model rule). Neither sits below `standard`, per
 * "a reviewer is at least as capable as the usual implementer". The verifier
 * decides disputes, so it takes the top tier.
 */
export const DEFAULT_SEATS: readonly SeatDefinition[] = [
  { seatId: 'reviewer-1', role: 'reviewer', tier: 'premium' },
  { seatId: 'reviewer-2', role: 'reviewer', tier: 'standard' },
  { seatId: 'verifier', role: 'verifier', tier: 'premium' },
];

/** CLI host mapping: tier → model id (the CLI provider maps ids to aliases). */
const CLI_TIER_MODEL: Record<SeatTier, string> = {
  premium: JURY_MODEL_IDS.opus,
  standard: JURY_MODEL_IDS.sonnet,
};

const API_PROVIDERS: AIProvider[] = ['claude', 'gemini', 'chatgpt'];

function aliasOf(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return modelId;
}

/**
 * Resolve the seats for one review.
 *
 * `RAPITAS_JURY_MODELS` (comma separated) still overrides the models, now by
 * seat order: reviewer-1, reviewer-2, verifier; a seat with no entry keeps
 * its tier default. Unlike the old panel it is NOT deduped — two seats on one
 * model are allowed but are then not counted as independent opinions.
 *
 * @param args.auxMode - Auxiliary AI mode (default: current) / 補助AIのモード
 * @param args.providers - Reachable providers for API mode / APIモードのプロバイダ
 * @returns Reviewer seats in order, and the verifier seat / 席の割り当て
 */
export function assignSeats(
  args: {
    auxMode?: ReturnType<typeof getAuxAiMode>;
    providers?: AIProvider[];
  } = {},
): { reviewers: [SeatAssignment, SeatAssignment]; verifier: SeatAssignment } {
  const auxMode = args.auxMode ?? getAuxAiMode();
  const [r1, r2, v] = DEFAULT_SEATS;

  if (auxMode !== 'cli') {
    const providers = args.providers?.length ? args.providers : API_PROVIDERS;
    const at = (def: SeatDefinition, i: number): SeatAssignment => {
      const provider = providers[i] ?? providers[0];
      const model = DEFAULT_MODELS[provider];
      return { ...def, provider, model, label: `${provider}:${model}` };
    };
    return { reviewers: [at(r1, 0), at(r2, 1)], verifier: at(v, 0) };
  }

  const overrides = (process.env.RAPITAS_JURY_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const at = (def: SeatDefinition, i: number): SeatAssignment => {
    const model = overrides[i] ?? CLI_TIER_MODEL[def.tier];
    return { ...def, provider: 'claude', model, label: `claude:${aliasOf(model)}` };
  };
  return { reviewers: [at(r1, 0), at(r2, 1)], verifier: at(v, 2) };
}
