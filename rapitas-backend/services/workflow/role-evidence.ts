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
 * indicts the VERIFIER. Roles not listed keep process-level success (their
 * output has no downstream gate that attributes failure to them).
 */
const ROLE_TROUBLE_CAUSES: Record<string, string[]> = {
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

  const byModel = new Map<string, { samples: number; successes: number }>();
  for (const r of rows) {
    if (!r.modelName) continue;
    const acc = byModel.get(r.modelName) ?? { samples: 0, successes: 0 };
    acc.samples += 1;
    const taskId = r.session?.config?.taskId;
    const gateRejected = typeof taskId === 'number' && troubledTasks.has(taskId);
    if (r.status === 'completed' && !r.errorMessage && !gateRejected) acc.successes += 1;
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
