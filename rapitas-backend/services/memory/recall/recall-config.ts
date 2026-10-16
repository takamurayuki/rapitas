/**
 * recall-config
 *
 * Reads and validates the `RAPITAS_KB_RECALL_*` / `RAPITAS_KB_LEXICAL_INDEX_TTL_MS`
 * environment knobs that govern knowledge recall (stages, weights, thresholds,
 * candidate pool, lexical channel). Single source of truth shared by the
 * workflow recall path, the task-RAG path, and the `/knowledge/search` API so
 * the threshold / stage set is never hard-coded in a caller again.
 */
import type { ForgettingStage } from '../types';

/** Resolved recall configuration (all fields validated, never NaN). */
export interface RecallConfig {
  /** Forgetting stages recalled from (at least one). */
  stages: ForgettingStage[];
  /** Rank multiplier per stage — ordering only, never a filter. */
  stageWeights: Record<ForgettingStage, number>;
  /** Cosine floor for the vector channel. */
  minSimilarity: number;
  /** Max entries injected into a prompt. */
  maxEntries: number;
  /** Vector candidate pool = limit × multiplier (pre-DB-filter). */
  candidateMultiplier: number;
  /** Whether the bigram lexical channel participates. */
  lexicalEnabled: boolean;
  /** Lexical coverage score floor (0..1). */
  lexicalMinScore: number;
  /** Lexical index cache lifetime in ms. */
  lexicalIndexTtlMs: number;
}

const ALL_STAGES: ForgettingStage[] = ['active', 'dormant', 'archived'];

const DEFAULTS: RecallConfig = {
  stages: [...ALL_STAGES],
  stageWeights: { active: 1, dormant: 0.85, archived: 0.6 },
  // 0.55 is the pre-existing workflow floor — deliberately NOT lowered; the
  // task constraint forbids injecting noise by loosening the cosine gate.
  minSimilarity: 0.55,
  maxEntries: 6,
  candidateMultiplier: 5,
  lexicalEnabled: true,
  lexicalMinScore: 0.15,
  lexicalIndexTtlMs: 600_000,
};

function isStage(v: string): v is ForgettingStage {
  return (ALL_STAGES as string[]).includes(v);
}

function numberOr(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/**
 * Parse the recall stage list (`active,dormant,archived`). Unknown tokens are
 * dropped; an empty result falls back to the default so a typo can never
 * silence recall entirely.
 */
function parseStages(raw: string | undefined): ForgettingStage[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULTS.stages];
  const seen = new Set<ForgettingStage>();
  for (const token of raw.split(',')) {
    const v = token.trim().toLowerCase();
    if (isStage(v)) seen.add(v);
  }
  return seen.size > 0 ? [...seen] : [...DEFAULTS.stages];
}

/** Parse `active=1,dormant=0.85,archived=0.6`; missing/invalid keys keep defaults. */
function parseStageWeights(raw: string | undefined): Record<ForgettingStage, number> {
  const weights = { ...DEFAULTS.stageWeights };
  if (raw === undefined || raw.trim() === '') return weights;
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=').map((s) => s.trim());
    if (!k) continue;
    const key = k.toLowerCase();
    if (!isStage(key)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 10) weights[key] = n;
  }
  return weights;
}

/**
 * Build a RecallConfig from an environment map. Pure — every invalid value
 * falls back to its own default independently of the others.
 *
 * @param env - Environment variables (usually `process.env`). / 環境変数
 * @returns Validated recall configuration. / 検証済み設定
 */
export function parseRecallConfig(env: Record<string, string | undefined>): RecallConfig {
  const lexicalRaw = env.RAPITAS_KB_RECALL_LEXICAL?.trim().toLowerCase();
  return {
    stages: parseStages(env.RAPITAS_KB_RECALL_STAGES),
    stageWeights: parseStageWeights(env.RAPITAS_KB_RECALL_STAGE_WEIGHTS),
    minSimilarity: numberOr(env.RAPITAS_KB_RECALL_MIN_SIMILARITY, DEFAULTS.minSimilarity, 0, 1),
    maxEntries: Math.floor(numberOr(env.RAPITAS_KB_RECALL_MAX_ENTRIES, DEFAULTS.maxEntries, 1, 50)),
    candidateMultiplier: Math.floor(
      numberOr(env.RAPITAS_KB_RECALL_CANDIDATE_MULTIPLIER, DEFAULTS.candidateMultiplier, 1, 50),
    ),
    lexicalEnabled:
      lexicalRaw === undefined || lexicalRaw === ''
        ? DEFAULTS.lexicalEnabled
        : !['0', 'false', 'off', 'no'].includes(lexicalRaw),
    lexicalMinScore: numberOr(
      env.RAPITAS_KB_RECALL_LEXICAL_MIN_SCORE,
      DEFAULTS.lexicalMinScore,
      0,
      1,
    ),
    lexicalIndexTtlMs: numberOr(
      env.RAPITAS_KB_LEXICAL_INDEX_TTL_MS,
      DEFAULTS.lexicalIndexTtlMs,
      1_000,
      86_400_000,
    ),
  };
}

let cached: RecallConfig | null = null;

/**
 * Process-wide recall configuration, read from `process.env` on first use.
 *
 * @returns The cached configuration. / キャッシュ済み設定
 */
export function getRecallConfig(): RecallConfig {
  if (!cached) cached = parseRecallConfig(process.env);
  return cached;
}

/** Drop the cached config so the next `getRecallConfig()` re-reads env (tests). */
export function resetRecallConfigCache(): void {
  cached = null;
}
