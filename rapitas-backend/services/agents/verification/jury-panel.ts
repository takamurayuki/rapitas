/**
 * JuryPanel
 *
 * Decides who sits on the adversarial diff-review jury. Owns only panel
 * composition; prompts, verdicts, aggregation and juror health stay in
 * adversarial-diff-review.ts and its siblings.
 *
 * The gate was designed as a cross-provider panel on the research basis in
 * adversarial-diff-review.ts (JudgeBench: a single LLM judge is near-chance on
 * objective correctness; PoLL: a small heterogeneous jury beats one frontier
 * judge). In Claude-only auxiliary CLI mode that panel silently became a
 * panel of one, because Gemini and OpenAI jurors are refused before they are
 * asked — correctly, since routing them through Claude would be the same vote
 * counted twice.
 *
 * Measured 2026-10-21 over the 876 recorded reviews: 209 of 209 October
 * reviews had exactly one real voter; where a second opinion still existed,
 * 51.4% (95% CI 41.1–60.7%, n=107) of that voter's fails were contested by
 * another model against 10.7% of its passes, and the fail was the minority in
 * 36 of 53 split reviews. A panel rebuilt from distinct Claude models restores
 * a real majority over the only jurors this host can actually reach.
 */
import { getAuxAiMode } from '../../../utils/ai-client';
import { DEFAULT_MODELS, type AIProvider } from '../../../utils/ai-client/types';

/** One seat on the panel. */
export interface JurorSpec {
  provider: AIProvider;
  model: string;
  /** Stable identity for health tracking and the recorded verdict. */
  label: string;
}

/** Providers used as jurors when more than one vendor is reachable. */
const JUDGE_PROVIDERS: AIProvider[] = ['claude', 'gemini', 'chatgpt'];

/**
 * The Claude models that can sit as separate jurors.
 *
 * Three tiers, so a majority exists without a tie. Kept here as full ids
 * because `sendAIMessage` takes an id and the CLI provider maps it to a
 * `--model` alias.
 */
export const JURY_MODEL_IDS = {
  opus: 'claude-opus-4-20250514',
  sonnet: 'claude-sonnet-4-20250514',
  haiku: 'claude-3-5-haiku-20241022',
} as const;

/**
 * Default panel: Opus, Sonnet, Sonnet.
 *
 * NOTE: Haiku was dropped from the default (2026-11-10, owner decision) under
 * the policy "a reviewer is at least as capable as the implementer" — Haiku
 * sat below the usual Sonnet/Opus implementer, so the quality gate's weakest
 * seat was its cheapest. Three seats are kept so a majority still exists
 * (ADR 0008: two voters tie, and a tie breaks to fail). The second Sonnet is
 * a separate, independent call — the only way to keep three seats without
 * seating a tier below the implementer. An explicit RAPITAS_JURY_MODELS list
 * still overrides this and is still deduped by tier.
 */
const DEFAULT_JURY_MODELS = [
  JURY_MODEL_IDS.opus,
  JURY_MODEL_IDS.sonnet,
  JURY_MODEL_IDS.sonnet,
] as const;

/**
 * Which distinct model each id actually reaches.
 *
 * Mirrors the CLI provider's own mapping, where anything unrecognised falls
 * back to Haiku. Two ids that reach the same model are one juror, not two, so
 * this is what the panel dedupes on — otherwise a single voter could hold a
 * majority by itself.
 */
function tierOf(modelId: string): keyof typeof JURY_MODEL_IDS {
  const m = modelId.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  return 'haiku';
}

/**
 * Resolve the configured juror models to distinct model ids.
 *
 * An explicit list is deduped by the model each id reaches; the default
 * deliberately seats Sonnet twice (see DEFAULT_JURY_MODELS).
 *
 * @param raw - `RAPITAS_JURY_MODELS` value (comma separated) / 環境変数の値
 * @returns Model ids in panel order / 陪審のモデルID列
 */
export function juryModelIds(raw: string | undefined = process.env.RAPITAS_JURY_MODELS): string[] {
  const requested = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (requested.length === 0) return [...DEFAULT_JURY_MODELS];
  const byTier = new Map<string, string>();
  for (const id of requested) {
    const tier = tierOf(id);
    if (!byTier.has(tier)) byTier.set(tier, JURY_MODEL_IDS[tier]);
  }
  const ids = [...byTier.values()];
  return ids.length > 0 ? ids : [...DEFAULT_JURY_MODELS];
}

/**
 * Build the panel for one review.
 *
 * The implementer's own model is seated LAST but never dropped: removing it
 * would leave two voters, where one harsh juror ties the vote and a tie breaks
 * to fail — strictly harsher than the single juror it replaced, and the
 * measurement says the harsh direction is already the problem.
 *
 * @param args.auxMode - Auxiliary AI mode / 補助AIのモード
 * @param args.implementerModel - Model the implementer ran, if known / 実装者のモデル
 * @returns Jurors in the order they should be asked / 問い合わせ順の陪審
 */
export function buildPanel(args: {
  auxMode?: ReturnType<typeof getAuxAiMode>;
  implementerModel: string | null;
  providers?: AIProvider[];
}): JurorSpec[] {
  const auxMode = args.auxMode ?? getAuxAiMode();
  if (auxMode !== 'cli') {
    const providers = args.providers ?? JUDGE_PROVIDERS;
    const implementer = args.implementerModel ? tierOrProvider(args.implementerModel) : null;
    const seats = providers.map((provider) => ({
      provider,
      model: DEFAULT_MODELS[provider],
      label: `${provider}:${DEFAULT_MODELS[provider]}`,
    }));
    return [
      ...seats.filter((s) => s.provider !== implementer),
      ...seats.filter((s) => s.provider === implementer),
    ];
  }

  const implementerTier = args.implementerModel ? tierOf(args.implementerModel) : null;
  // A tier seated twice (the default Sonnet pair) gets `#2` so health
  // tracking and the recorded votes keep the two calls apart.
  const seen = new Map<string, number>();
  const seats = juryModelIds().map((model) => {
    const tier = tierOf(model);
    const n = (seen.get(tier) ?? 0) + 1;
    seen.set(tier, n);
    return {
      provider: 'claude' as AIProvider,
      model,
      label: n === 1 ? `claude:${tier}` : `claude:${tier}#${n}`,
    };
  });
  return [
    ...seats.filter((s) => tierOf(s.model) !== implementerTier),
    ...seats.filter((s) => tierOf(s.model) === implementerTier),
  ];
}

/** Which provider family a model id belongs to, for the cross-vendor panel. */
function tierOrProvider(modelId: string): AIProvider | null {
  const m = modelId.toLowerCase();
  if (m.includes('claude')) return 'claude';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3')) return 'chatgpt';
  if (m.includes('gemini')) return 'gemini';
  return null;
}
