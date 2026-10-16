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

/** Recent trailing window that catches fresh degradation before the long window dilutes it. */
const RECENT_WINDOW_DAYS = 14;

/** The recent-window check applies only once a model has this many recent samples. */
const RECENT_MIN_SAMPLES = 4;

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
  recentSamples: number;
  recentSuccesses: number;
  recentSuccessRate: number;
}

interface OutcomeRow {
  status: string;
  errorMessage: string | null;
  modelName: string | null;
  createdAt?: Date | string | null;
  session?: { config?: { taskId?: number | null } | null } | null;
}

/**
 * Workflow-transition causes that indict a ROLE's output quality, per role.
 * An execution can end status='completed' while its work was REJECTED by the
 * verify/adversarial gates (the bounce re-runs as a NEW execution; only repair
 * exhaustion marks an execution failed) — counting those as successes let a
 * cheap model look "proven" while it was actually bouncing constantly, which
 * would lower the role floor and degrade quality. Verify-phase bounces indict
 * the IMPLEMENTER (its diff was rejected); a self-contradicting verify.md
 * indicts the VERIFIER; critic-gate bounces indict the RESEARCHER/PLANNER
 * whose document was rejected. Roles not listed keep process-level success
 * (their output has no downstream gate that attributes failure to them).
 */
// NOTE: exported so prompt-evolution-runner shares the SAME success definition
// (gate-bounce detection) instead of duplicating the cause list.
// NOTE: *_critic_exhausted (bounce cap reached, forced forward) is deliberately
// NOT attributed — the doc that finally advanced was never accepted by the gate,
// so exhaustion says more about the cap than about the last revision's quality.
export const ROLE_TROUBLE_CAUSES: Record<string, string[]> = {
  researcher: ['research_critic_failed'],
  planner: ['plan_critic_failed', 'plan_invalid_replan'],
  implementer: ['verify_repair', 'adversarial_review_failed', 'ci_repair', 'verify_no_changes'],
  verifier: ['verify_validation_failed', 'log_polluted_rejected'],
  auto_verifier: ['verify_validation_failed', 'log_polluted_rejected'],
};

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
 * For gated roles (see ROLE_TROUBLE_CAUSES) a success additionally requires
 * that the task recorded NO role-indicting rejection — "the process exited 0"
 * is not evidence that the WORK was acceptable.
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
    select: {
      status: true,
      errorMessage: true,
      modelName: true,
      createdAt: true,
      session: { select: { config: { select: { taskId: true } } } },
    },
  })) as OutcomeRow[];

  // Gate-rejection lookup: tasks whose verify/adversarial transitions indict
  // this role's output. Best-effort — a query failure yields an empty set,
  // i.e. the (legacy, more permissive) process-level success definition.
  const troubleCauses = ROLE_TROUBLE_CAUSES[role] ?? [];
  const taskIds = [
    ...new Set(
      rows
        .map((r) => r.session?.config?.taskId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  let troubledTasks = new Set<number>();
  if (troubleCauses.length > 0 && taskIds.length > 0) {
    const troubleRows = await prisma.workflowTransition
      .findMany({
        where: {
          taskId: { in: taskIds },
          cause: { in: troubleCauses },
          createdAt: { gte: cutoff },
        },
        select: { taskId: true },
        distinct: ['taskId'],
      })
      .catch(() => [] as Array<{ taskId: number }>);
    troubledTasks = new Set(troubleRows.map((t) => t.taskId));
  }

  // Recent bucket boundary. Rows without a usable createdAt fall OUTSIDE the
  // recent window, so legacy fixtures/rows degrade to long-window-only stats.
  const recentCutoff = new Date();
  recentCutoff.setUTCDate(recentCutoff.getUTCDate() - RECENT_WINDOW_DAYS);

  const byModel = new Map<
    string,
    { samples: number; successes: number; recentSamples: number; recentSuccesses: number }
  >();
  for (const r of rows) {
    if (!r.modelName) continue;
    const acc = byModel.get(r.modelName) ?? {
      samples: 0,
      successes: 0,
      recentSamples: 0,
      recentSuccesses: 0,
    };
    acc.samples += 1;
    const taskId = r.session?.config?.taskId;
    const gateRejected = typeof taskId === 'number' && troubledTasks.has(taskId);
    const success = r.status === 'completed' && !r.errorMessage && !gateRejected;
    if (success) acc.successes += 1;
    const createdAt = r.createdAt ? new Date(r.createdAt) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime()) && createdAt >= recentCutoff) {
      acc.recentSamples += 1;
      if (success) acc.recentSuccesses += 1;
    }
    byModel.set(r.modelName, acc);
  }

  return Array.from(byModel.entries())
    .map(([modelName, a]) => ({
      modelName,
      tier: classifyTier(modelName),
      samples: a.samples,
      successes: a.successes,
      successRate: a.samples > 0 ? a.successes / a.samples : 0,
      recentSamples: a.recentSamples,
      recentSuccesses: a.recentSuccesses,
      recentSuccessRate: a.recentSamples > 0 ? a.recentSuccesses / a.recentSamples : 0,
    }))
    .sort((a, b) => b.samples - a.samples);
}

interface CacheEntry {
  tier: ModelTier | undefined;
  expiresAt: number;
}

const provenTierCache = new Map<string, CacheEntry>();

/** Per-model selection audit line for the resolveProvenTier log. */
interface TierEvaluation {
  modelName: string;
  tier: ModelTier;
  samples: number;
  successRate: number;
  recentSamples: number;
  recentSuccessRate: number;
  proven: boolean;
  rejectedBy: 'window45' | 'recent14' | null;
}

/**
 * Resolve the cheapest model tier with a PROVEN track record for a role:
 * some model of that tier ran the role ≥ minSamples times in the 45-day window
 * with a success rate ≥ minSuccessRate, AND — when the model has at least
 * RECENT_MIN_SAMPLES runs in the last RECENT_WINDOW_DAYS days — the recent
 * success rate also clears the same floor. The recent gate stops a freshly
 * degrading model from staying "proven" on diluted long-window stats; with
 * too few recent samples the long window alone decides.
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

  const evaluations: TierEvaluation[] = outcomes.map((o) => {
    const longOk = o.samples >= samplesFloor && o.successRate >= successFloor;
    const recentApplies = o.recentSamples >= RECENT_MIN_SAMPLES;
    const recentOk = !recentApplies || o.recentSuccessRate >= successFloor;
    return {
      modelName: o.modelName,
      tier: o.tier,
      samples: o.samples,
      successRate: o.successRate,
      recentSamples: o.recentSamples,
      recentSuccessRate: o.recentSuccessRate,
      proven: longOk && recentOk,
      rejectedBy: longOk ? (recentOk ? null : 'recent14') : 'window45',
    };
  });

  const provenTiers = new Set<ModelTier>(evaluations.filter((e) => e.proven).map((e) => e.tier));
  const tier = TIER_CHEAP_FIRST.find((t) => provenTiers.has(t));

  if (evaluations.length > 0) {
    log.info(
      {
        role,
        tier: tier ?? null,
        accepted: evaluations.filter((e) => e.proven),
        rejected: evaluations.filter((e) => !e.proven),
      },
      tier
        ? 'Evidence-proven tier resolved for role'
        : 'No evidence-proven tier for role (all models rejected)',
    );
  }

  provenTierCache.set(role, { tier, expiresAt: Date.now() + CACHE_TTL_MS });
  return tier;
}

/**
 * How much better premium must measurably be, in success-rate points, before
 * a premium FLOOR is worth paying for. Small on purpose: this only has to rule
 * out 'no advantage at all'.
 */
function premiumAdvantageThreshold(): number {
  const v = parseFloat(process.env.RAPITAS_PREMIUM_ADVANTAGE_MIN ?? '');
  return Number.isFinite(v) && v >= 0 ? v : 0.03;
}

/** Verdict on whether a premium floor is earned for a role. */
export interface PremiumAdvantage {
  justified: boolean;
  reason: string;
  premiumRate?: number;
  standardRate?: number;
  /** Which evidence answered: the decision ledger, or raw execution statuses. */
  source?: 'ledger' | 'executions';
}

/**
 * Whether the recorded outcomes justify FORCING premium for this role.
 *
 * The evidence layer has only ever answered the downgrade question ('which is
 * the cheapest tier that works?'). Nothing ever checked the opposite: that an
 * upgrade bought anything. Measured 2026-08-25 over 14 days, premium carried
 * 58% of spend at a LOWER success rate than standard, and no reduction in
 * verify-repair rounds was detectable. An upgrade should have to earn itself
 * the same way a downgrade does.
 *
 * Returns undefined when either tier lacks the sample floor — absence of
 * evidence keeps the caller's existing behaviour rather than silently
 * relaxing a floor.
 *
 * @param role - Workflow role. / ワークフローのロール
 * @returns The verdict, or undefined when evidence is insufficient. / 判定、証拠不足なら undefined
 */
export async function resolvePremiumAdvantage(role: string): Promise<PremiumAdvantage | undefined> {
  if (!evidenceRoutingEnabled()) return undefined;

  const floor = minSamples();

  // Ask the ledger first. It judges the DECISION, so a run that died on a spend
  // limit or an upstream 5xx settles as indeterminate and is excluded — whereas
  // raw execution statuses count it against whichever tier happened to be
  // chosen, which is how an upgrade can look unjustified because the
  // infrastructure wobbled. Falls through when the ledger is still too thin;
  // it only started settling decisions on 2026-08-26.
  const fromLedger = await resolveFromLedger(role, floor).catch(() => undefined);
  if (fromLedger) {
    log.info({ role, ...fromLedger }, 'Premium-advantage verdict resolved for role');
    return fromLedger;
  }

  const outcomes = await getRoleModelOutcomes(role).catch(() => [] as RoleModelOutcome[]);
  if (outcomes.length === 0) return undefined;

  const agg = (tier: ModelTier) => {
    const rows = outcomes.filter((o) => o.tier === tier);
    const samples = rows.reduce((a, r) => a + r.samples, 0);
    const successes = rows.reduce((a, r) => a + r.successes, 0);
    return { samples, rate: samples > 0 ? successes / samples : 0 };
  };

  const premium = agg('premium');
  const standard = agg('standard');
  if (premium.samples < floor || standard.samples < floor) return undefined;

  const margin = premium.rate - standard.rate;
  const justified = margin >= premiumAdvantageThreshold();
  const verdict: PremiumAdvantage = {
    justified,
    reason: justified
      ? `premium は standard を ${(margin * 100).toFixed(1)}pt 上回る実績`
      : `premium に standard を上回る実績が無い(${(margin * 100).toFixed(1)}pt)`,
    premiumRate: premium.rate,
    standardRate: standard.rate,
    source: 'executions',
  };
  log.info(
    { role, ...verdict, premiumSamples: premium.samples, standardSamples: standard.samples },
    'Premium-advantage verdict resolved for role',
  );
  return verdict;
}
/**
 * Same verdict, computed from settled ledger decisions instead of execution
 * statuses. Returns undefined when either tier is below the sample floor, so an
 * insufficient ledger silently defers to the older evidence rather than
 * relaxing a floor on thin data.
 */
async function resolveFromLedger(
  role: string,
  floor: number,
): Promise<PremiumAdvantage | undefined> {
  const { tierOutcomesForRole } = await import('../decision-ledger');
  const outcomes = await tierOutcomesForRole(role);
  const premium = outcomes.find((o) => o.tier === 'premium');
  const standard = outcomes.find((o) => o.tier === 'standard');
  if (!premium || !standard) return undefined;
  if (premium.samples < floor || standard.samples < floor) return undefined;

  const margin = premium.rate - standard.rate;
  const justified = margin >= premiumAdvantageThreshold();
  return {
    justified,
    reason: justified
      ? `premium は standard を ${(margin * 100).toFixed(1)}pt 上回る実績(台帳 ${premium.samples}/${standard.samples}件)`
      : `premium に standard を上回る実績が無い(${(margin * 100).toFixed(1)}pt、台帳 ${premium.samples}/${standard.samples}件)`,
    premiumRate: premium.rate,
    standardRate: standard.rate,
    source: 'ledger',
  };
}

/** Test-only: clear the proven-tier cache. */
export function _resetProvenTierCache(): void {
  provenTierCache.clear();
}
