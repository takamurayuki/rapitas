/**
 * routing-policy
 *
 * Deterministic guardrails layered on top of SmartRouter's complexity tier.
 * The philosophy: do NOT try to predict difficulty from task text (a weak
 * signal). Instead be safe by default and let EVIDENCE raise capability:
 *  - role floor      — capability-critical phases never drop below 'standard'
 *  - risk override   — a high-risk verdict from risk-detection.ts forces 'premium'
 *  - failure escalate — each queue retry bumps the floor to 'premium' (a weak
 *                       model that already failed should not run again)
 *
 * Not responsible for detecting risk itself (schema/auth/payment/security
 * signal matching) — see risk-detection.ts, whose `detectHighRisk` result
 * this module receives as the `riskHigh` boolean.
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
 * Failure causes that say NOTHING about the model's capability: the phase
 * never got a fair run, or it was stopped by the platform. Escalating the tier
 * on these is pure waste — the same infrastructure failure will greet a
 * premium model too.
 *
 * Measured 2026-08-23 over the queue's recorded retry causes: 237 of the
 * retries in the trailing window came from these classes — provider spend
 * limit (69), an un-runnable workflow status (105), a task already blocked
 * (12), and a missing artifact after a stopped run (51). Each one lifted the
 * next attempt's floor to `premium`, which is the single largest premium pump
 * in the router (55% of routing decisions resolved premium in that window).
 */
const NON_CAPABILITY_FAILURE_RE =
  /(you'?ve hit your (?:\w+[- ])*(?:spend|usage|rate) limit|claude\.ai\/settings\/usage|codex\/settings\/usage|credit[ _]?balance[ _]?too[ _]?low|quota exceeded|resource_exhausted|rate_limit_error|api error:?\s*5\d\d|internal server error|service unavailable|bad gateway|gateway timeout|overloaded_error|rate[ _-]limit(?:ed|ing)?|overloaded|(?:http |status )?429|invalid api key|not (?:authenticated|logged in)|では次のフェーズを実行できません|ブロック中のため|ワークフロー無効モード|auto-run stopped|cancelled by user|phase execution timeout|timed out)/i;

/**
 * Whether a prior attempt's failure can fairly be blamed on the model.
 *
 * Unknown / unrecorded causes return true (escalate) — the conservative side:
 * today every retry escalates, so an unparsed message keeps that behaviour.
 *
 * @param cause - The queue item's recorded errorMessage, if any. / 記録された失敗理由
 * @returns true when a stronger model is a plausible remedy. / モデル起因なら true
 */
export function isCapabilityAttributableFailure(cause?: string | null): boolean {
  const text = (cause ?? '').trim();
  if (!text) return true;
  return !NON_CAPABILITY_FAILURE_RE.test(text);
}

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
 *    a SOFT signal and is CAPPED AT 'standard' — it never forces premium.
 *    Self-repair bounces are ROUTINE, so the aggregate rate saturates: measured
 *    2026-08-18, 6/10 recent tasks carried a `verify_repair` transition, which
 *    put level 2 (≥50%) permanently in effect and pinned EVERY phase of EVERY
 *    task in the theme to premium — 16/18 routing decisions resolved to
 *    claude-fable-5, including complexity-5 and complexity-22 tasks, and
 *    premium took 78% of spend on 35% of executions. A theme-wide average can
 *    never justify premium for an individual cheap phase; only task-specific
 *    signals (retry) and risk signals may.
 * Risk floors are never relaxed by history.
 *
 * @param opts.role - Workflow role being executed. / 実行中のロール
 * @param opts.taskRetries - Prior failed attempts of THIS task (queue retryCount). / このタスクの失敗回数
 * @param opts.retryCause - The last recorded failure message, if any. / 直近の失敗理由
 * @param opts.themeEscalation - Theme-level trouble signal 0-2 (recentThemeEscalation). / テーマ困難度
 * @param opts.riskHigh - Whether detectHighRisk flagged the work. / 高リスクか
 * @param opts.provenTier - Evidence-proven cheaper tier for this role, if any. / 実証済みティア
 * @returns The floor tier plus the rule that set it. / 下限ティアと適用理由
 */
export function computeMinTierWithReason(opts: {
  role: string;
  taskRetries: number;
  themeEscalation?: number;
  riskHigh: boolean;
  provenTier?: ModelTier;
  retryCause?: string | null;
  /**
   * Recorded verdict on whether premium outperforms standard for this role.
   * `false` caps any premium floor at standard; `undefined` (no evidence)
   * keeps the floor as-is.
   */
  premiumJustified?: boolean;
}): { tier: ModelTier | undefined; reason?: string } {
  let roleFloor: ModelTier | undefined = isCapabilityRole(opts.role) ? 'standard' : undefined;
  if (
    roleFloor &&
    opts.provenTier &&
    TIER_ORDER.indexOf(opts.provenTier) > TIER_ORDER.indexOf(roleFloor)
  ) {
    roleFloor = opts.provenTier;
  }
  // A weak model already failed this task — go strong on the retry, but ONLY
  // when the failure is something a stronger model could actually fix. A run
  // that died on a provider spend limit, a timeout, or an un-runnable workflow
  // status proves nothing about capability (see NON_CAPABILITY_FAILURE_RE).
  const retryFloor: ModelTier | undefined =
    opts.taskRetries >= 1 && isCapabilityAttributableFailure(opts.retryCause)
      ? 'premium'
      : undefined;
  const theme = opts.themeEscalation ?? 0;
  // NOTE: Level 2 no longer forces premium — see the doc comment above. Both
  // levels cap at 'standard'; the level is kept in the signature because it
  // still distinguishes "no signal" from "theme is struggling" for telemetry.
  const themeFloor: ModelTier | undefined = theme >= 1 ? 'standard' : undefined;
  // REACTIVE, not predictive. Evidence-confirmed risk lifts the first attempt
  // to 'standard' and only reaches premium once an attempt has actually
  // failed. Failure is cheap in this architecture — the verify gate, the
  // adversarial review and self-repair all run before anything merges — so
  // paying premium on a prediction costs more than escalating on a
  // measurement. Measured 2026-08-25: standard completed 99.3% of executions
  // at a fifth of premium's cost, and no reduction in verify-repair rounds was
  // detectable for premium. Set RAPITAS_RISK_FLOOR_PREDICTIVE=1 to restore the
  // old pay-up-front behaviour.
  const predictiveRisk = (process.env.RAPITAS_RISK_FLOOR_PREDICTIVE ?? '').trim() === '1';
  const riskFloor: ModelTier | undefined = opts.riskHigh
    ? predictiveRisk || opts.taskRetries >= 1
      ? 'premium'
      : 'standard'
    : undefined;
  const rawTier = highestTier(roleFloor, retryFloor, themeFloor, riskFloor);

  // Name the STRONGEST contributor — the one that actually set the floor. Ties
  // resolve to the most specific signal (risk > this task's retry > theme >
  // role) so the audit trail points at the rule an operator can act on.
  const candidates: Array<[ModelTier | undefined, string]> = [
    [riskFloor, '高リスク領域(スキーマ/認証/決済/セキュリティ)'],
    [retryFloor, 'このタスクの再試行'],
    [themeFloor, 'テーマの困難度'],
    [roleFloor, `ロール下限(${opts.role})`],
  ];
  const rawReason = candidates.find(([t]) => t !== undefined && t === rawTier)?.[1];

  // An UPGRADE must earn itself the same way a downgrade does. resolveProvenTier
  // has always answered 'which is the cheapest tier that works?'; nothing ever
  // checked that paying more bought anything. When the recorded outcomes say
  // premium has no measured advantage for this role, a premium floor is capped
  // at standard. `undefined` means insufficient evidence and changes nothing.
  if (rawTier === 'premium' && opts.premiumJustified === false) {
    return {
      tier: 'standard',
      reason: rawReason ? `${rawReason}(premium実績なしのためstandardに抑制)` : undefined,
    };
  }
  return { tier: rawTier, reason: rawReason };
}

/**
 * Backwards-compatible wrapper returning only the floor tier.
 *
 * @param opts - Same inputs as {@link computeMinTierWithReason}. / 同じ入力
 * @returns The floor tier, or undefined for no floor. / 下限ティア
 */
export function computeMinTier(opts: {
  role: string;
  taskRetries: number;
  themeEscalation?: number;
  riskHigh: boolean;
  provenTier?: ModelTier;
  retryCause?: string | null;
}): ModelTier | undefined {
  return computeMinTierWithReason(opts).tier;
}
