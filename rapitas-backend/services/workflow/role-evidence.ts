/**
 * role-evidence
 *
 * Evidence-based model-tier resolution from RECORDED execution outcomes.
 * Answers "which is the cheapest model tier that has PROVEN it can do this
 * workflow role?" using the per-role × per-model success rates already
 * captured in AgentExecution (joined via AgentSession.mode). Pure read-side
 * aggregation — it never blocks routing (callers treat undefined as "no
 * evidence, keep the heuristic tier").
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { classifyTier } from '../ai/model-discovery/tier-classifier';
import type { ModelTier } from '../ai/model-discovery';

const log = createLogger('role-evidence');

/** Trailing window for outcome evidence. Long enough for sample size, short enough to track model churn. */
const WINDOW_DAYS = 45;

/** Evidence is re-queried at most once per role per TTL. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Cheapest → most expensive; resolveProvenTier returns the FIRST proven entry. */
const TIER_CHEAP_FIRST: ModelTier[] = ['free', 'economy', 'standard', 'premium'];

export interface RoleModelOutcome {
  modelName: string;
  tier: ModelTier;
  samples: number;
  successes: number;
  successRate: number;
}

interface OutcomeRow {
  status: string;
  errorMessage: string | null;
  modelName: string | null;
}

/** Minimum samples before a model's record counts as evidence. */
function minSamples(): number {
  const v = parseInt(process.env.RAPITAS_EVIDENCE_MIN_SAMPLES ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
}

/** Minimum success rate for a model to be considered proven. */
function minSuccessRate(): number {
  const v = parseFloat(process.env.RAPITAS_EVIDENCE_MIN_SUCCESS ?? '');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.9;
}

/** Kill switch: RAPITAS_EVIDENCE_ROUTING=0 disables evidence-based routing. */
function evidenceRoutingEnabled(): boolean {
  return process.env.RAPITAS_EVIDENCE_ROUTING !== '0';
}

/**
 * Aggregate recorded outcomes per model for one workflow role.
 *
 * Executions with a null modelName are excluded — those are runs that died
 * before the CLI reported usage, so they cannot be attributed to a model.
 *
 * @param role - Workflow role (e.g. "implementer") / ワークフローロール
 * @param windowDays - Trailing window in days (default 45) / 集計対象日数
 * @returns Per-model outcome stats, most-sampled first / モデル別実績
 */
export async function getRoleModelOutcomes(
  role: string,
  windowDays = WINDOW_DAYS,
): Promise<RoleModelOutcome[]> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);

  const rows = (await prisma.agentExecution.findMany({
    where: {
      createdAt: { gte: cutoff },
      modelName: { not: null },
      session: { mode: `workflow-${role}` },
    },
    select: { status: true, errorMessage: true, modelName: true },
  })) as OutcomeRow[];

  const byModel = new Map<string, { samples: number; successes: number }>();
  for (const r of rows) {
    if (!r.modelName) continue;
    const acc = byModel.get(r.modelName) ?? { samples: 0, successes: 0 };
    acc.samples += 1;
    if (r.status === 'completed' && !r.errorMessage) acc.successes += 1;
    byModel.set(r.modelName, acc);
  }

  return Array.from(byModel.entries())
    .map(([modelName, a]) => ({
      modelName,
      tier: classifyTier(modelName),
      samples: a.samples,
      successes: a.successes,
      successRate: a.samples > 0 ? a.successes / a.samples : 0,
    }))
    .sort((a, b) => b.samples - a.samples);
}

interface CacheEntry {
  tier: ModelTier | undefined;
  expiresAt: number;
}

const provenTierCache = new Map<string, CacheEntry>();

/**
 * Resolve the cheapest model tier with a PROVEN track record for a role:
 * some model of that tier ran the role ≥ minSamples times in the window with
 * a success rate ≥ minSuccessRate.
 *
 * @param role - Workflow role / ワークフローロール
 * @returns The proven tier, or undefined when evidence is insufficient or
 *          the feature is disabled / 実証済みティア（証拠不足時はundefined）
 */
export async function resolveProvenTier(role: string): Promise<ModelTier | undefined> {
  if (!evidenceRoutingEnabled()) return undefined;

  const cached = provenTierCache.get(role);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const outcomes = await getRoleModelOutcomes(role);
  const samplesFloor = minSamples();
  const successFloor = minSuccessRate();

  const provenTiers = new Set<ModelTier>(
    outcomes
      .filter((o) => o.samples >= samplesFloor && o.successRate >= successFloor)
      .map((o) => o.tier),
  );
  const tier = TIER_CHEAP_FIRST.find((t) => provenTiers.has(t));

  if (tier) {
    log.info(
      { role, tier, evidence: outcomes.filter((o) => provenTiers.has(o.tier)) },
      'Evidence-proven tier resolved for role',
    );
  }

  provenTierCache.set(role, { tier, expiresAt: Date.now() + CACHE_TTL_MS });
  return tier;
}

/** Test-only: clear the proven-tier cache. */
export function _resetProvenTierCache(): void {
  provenTierCache.clear();
}
