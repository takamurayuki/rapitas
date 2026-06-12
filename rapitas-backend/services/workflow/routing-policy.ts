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

/** Phases that produce or judge code and therefore need real capability. */
const CAPABILITY_ROLES = new Set(['implementer', 'reviewer', 'verifier', 'auto_verifier']);

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
 * @returns true for implementer / reviewer / verifier. / 該当ロールなら true
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
 * escalation level, and the risk override. Returned to SmartRouter as
 * `minTier`, which only ever RAISES the complexity/budget tier.
 *
 * @param opts.role - Workflow role being executed. / 実行中のロール
 * @param opts.escalation - Prior failed attempts for this task (queue retryCount). / 失敗回数
 * @param opts.riskHigh - Whether detectHighRisk flagged the work. / 高リスクか
 * @returns The floor tier, or undefined for no floor. / 下限ティア（無ければ undefined）
 */
export function computeMinTier(opts: {
  role: string;
  escalation: number;
  riskHigh: boolean;
}): ModelTier | undefined {
  const roleFloor: ModelTier | undefined = isCapabilityRole(opts.role) ? 'standard' : undefined;
  // A weak model already failed this task — go strong on the retry.
  const escalationFloor: ModelTier | undefined = opts.escalation >= 1 ? 'premium' : undefined;
  const riskFloor: ModelTier | undefined = opts.riskHigh ? 'premium' : undefined;
  return highestTier(roleFloor, escalationFloor, riskFloor);
}
