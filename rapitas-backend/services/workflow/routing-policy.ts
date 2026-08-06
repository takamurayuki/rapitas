/**
 * routing-policy
 *
 * Deterministic guardrails layered on top of SmartRouter's complexity tier.
 * The philosophy: do NOT try to predict difficulty from task text (a weak
 * signal). Instead be safe by default and let EVIDENCE raise capability:
 *  - role floor      — capability-critical phases never drop below 'standard'
 *  - risk override   — schema / auth / payment / security touches force 'premium'
 *  - failure escalate — each queue retry bumps the floor to 'premium' (a weak
 *                       model that already failed should not run again)
 *
 * Pure functions only — no I/O — so they are cheap and unit-testable.
 */
import type { ModelTier } from '../ai/model-discovery';

/** Highest → lowest capability. Index 0 is the strongest tier. */
const TIER_ORDER: ModelTier[] = ['premium', 'standard', 'economy', 'free'];

/**
 * Phases that produce or judge code — or produce the PLAN all code follows —
 * and therefore need real capability. Planner is included: a defective plan is
 * the most expensive failure mode (every implementation step inherits it, and
 * it passes a human approval gate that anchors on it), so it must not run on
 * an economy model just because the task metadata scored low complexity.
 */
const CAPABILITY_ROLES = new Set(['implementer', 'planner', 'verifier', 'auto_verifier']);

/**
 * Presence of any of these in the task text OR plan marks the work high-risk:
 * data-model / migrations, authn-authz, money, and security-sensitive areas.
 * A mistake here is expensive, so capability is forced up regardless of size.
 */
const HIGH_RISK_RE =
  /(prisma|schema\.prisma|migration|migrate|\bauth\b|認証|ログイン|\blogin\b|password|パスワード|\btoken\b|secret|credential|encryption|暗号|決済|課金|payment|billing|security|セキュリティ|権限|permission|rbac|csrf|xss|sql\s*injection)/i;

/** Risky file-path markers, matched against plan.md's planned-files section. */
const HIGH_RISK_PATH_RE =
  /(prisma[\\/]schema|migrations?[\\/]|[\\/]auth|payment|billing|security)/i;

/**
 * Returns the strongest (highest-capability) tier among the given tiers.
 *
 * @param tiers - Candidate tiers; undefined entries are ignored. / 候補ティア
 * @returns The strongest tier, or undefined when none supplied. / 最強ティア
 */
export function highestTier(...tiers: Array<ModelTier | undefined>): ModelTier | undefined {
  const idxs = tiers.filter((t): t is ModelTier => !!t).map((t) => TIER_ORDER.indexOf(t));
  if (idxs.length === 0) return undefined;
  return TIER_ORDER[Math.min(...idxs)];
}

/**
 * Whether a role produces or judges code (and so needs a capability floor).
 *
 * @param role - Workflow role. / ワークフローロール
 * @returns true for implementer / planner / verifier. / 該当ロールなら true
 */
export function isCapabilityRole(role: string): boolean {
  return CAPABILITY_ROLES.has(role);
}

/**
 * Detect high-risk work from task text and (optionally) the plan.
 *
 * @param opts.text - Task title + description + labels. / タスク本文
 * @param opts.planContent - plan.md content, when available. / 計画書の内容
 * @returns Whether the work is high-risk and why. / 高リスク判定と理由
 */
export function detectHighRisk(opts: { text?: string | null; planContent?: string | null }): {
  high: boolean;
  reason?: string;
} {
  const text = (opts.text ?? '').toString();
  if (HIGH_RISK_RE.test(text)) {
    return {
      high: true,
      reason: 'task text matches a high-risk domain (data/auth/payment/security)',
    };
  }
  const plan = opts.planContent ?? '';
  if (plan && (HIGH_RISK_RE.test(plan) || HIGH_RISK_PATH_RE.test(plan))) {
    return {
      high: true,
      reason: 'plan touches high-risk files (schema/migration/auth/payment/security)',
    };
  }
  return { high: false };
}

/**
 * Compute the minimum model tier for a phase from the role floor, the failure
 * signals, and the risk override. Returned to SmartRouter as `minTier`, which
 * only ever RAISES the complexity/budget tier.
 *
 * The static role floor exists because, absent evidence, capability phases
 * are unsafe on economy models. When the caller supplies `provenTier` —
 * a cheaper tier with a measured ≥90% success record for THIS role (see
 * role-evidence.ts) — the role floor relaxes to it.
 *
 * Failure signals are deliberately SPLIT by specificity:
 *  - `taskRetries` (this exact task already failed) is a HARD signal → premium.
 *  - `themeEscalation` (aggregate trouble rate of the theme's recent tasks) is
 *    a SOFT signal. Self-repair bounces are ROUTINE — ≥25% of recent tasks
 *    having one is the common case, and treating that as premium put EVERY
 *    phase of EVERY task (researcher included) on the top model indefinitely
 *    (observed: 122/122 recent executions on opus). Level 1 (≥25%) now only
 *    raises the floor to 'standard'; level 2 (≥50% — the theme is genuinely
 *    struggling) still forces premium.
 * Risk floors are never relaxed by history.
 *
 * @param opts.role - Workflow role being executed. / 実行中のロール
 * @param opts.taskRetries - Prior failed attempts of THIS task (queue retryCount). / このタスクの失敗回数
 * @param opts.themeEscalation - Theme-level trouble signal 0-2 (recentThemeEscalation). / テーマ困難度
 * @param opts.riskHigh - Whether detectHighRisk flagged the work. / 高リスクか
 * @param opts.provenTier - Evidence-proven cheaper tier for this role, if any. / 実証済みティア
 * @returns The floor tier, or undefined for no floor. / 下限ティア（無ければ undefined）
 */
export function computeMinTier(opts: {
  role: string;
  taskRetries: number;
  themeEscalation?: number;
  riskHigh: boolean;
  provenTier?: ModelTier;
}): ModelTier | undefined {
  let roleFloor: ModelTier | undefined = isCapabilityRole(opts.role) ? 'standard' : undefined;
  if (
    roleFloor &&
    opts.provenTier &&
    TIER_ORDER.indexOf(opts.provenTier) > TIER_ORDER.indexOf(roleFloor)
  ) {
    roleFloor = opts.provenTier;
  }
  // A weak model already failed this task — go strong on the retry.
  const retryFloor: ModelTier | undefined = opts.taskRetries >= 1 ? 'premium' : undefined;
  const theme = opts.themeEscalation ?? 0;
  const themeFloor: ModelTier | undefined =
    theme >= 2 ? 'premium' : theme >= 1 ? 'standard' : undefined;
  const riskFloor: ModelTier | undefined = opts.riskHigh ? 'premium' : undefined;
  return highestTier(roleFloor, retryFloor, themeFloor, riskFloor);
}
