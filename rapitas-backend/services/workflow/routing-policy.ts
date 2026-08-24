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
 * STRONG risk signals: authn-authz, money, and attack-class vocabulary that
 * almost never appears in this app's benign domain text. Any hit forces
 * premium immediately, with no context requirement — false negatives here are
 * far more expensive than over-firing, so this list must never be relaxed.
 * NOTE: 認証 stays strong on purpose — it is the core auth word; CLI-auth
 * task over-firing is accepted as the safe side.
 * NOTE: \btoken\b does NOT match LLM-usage vocabulary — `_` and a trailing
 * `s` are word characters, so `MAX_TOKENS` / `tokens used` have no word
 * boundary around "token" and never fire (asserted by the LLM-context tests).
 */
const STRONG_RISK_RE =
  /(\bauth\b|認証|ログイン|\blogin\b|password|パスワード|\btoken\b|secret|credential|決済|課金|payment|billing|rbac|csrf|xss|sql\s*injection)/i;

/**
 * Data-layer signals: work that CHANGES the schema, not work that merely uses
 * the ORM. Every signal is structural — a schema file, a migration directory,
 * the Prisma DSL, or the command that applies a change.
 *
 * NOTE: this used to be `/(prisma|schema\.prisma|migration|migrate)/i`, which
 * matched the bare word `prisma`. In this codebase almost every backend file
 * imports the client, so any plan that quoted an import line was classified as
 * high-risk and forced to a premium model. Measured 2026-08-24 over 114 plans:
 * the old pattern fired on 62%, and of the plans it flagged on this signal
 * alone only 5 of 34 actually touched the schema — an 85% false-positive rate.
 * Task 627, a mechanical "split this file" refactor, ran its implementer on the
 * top-tier model because its plan quoted
 * `import { prisma } from '../../config';`.
 *
 * Natural-language phrasing was evaluated and deliberately rejected: plans
 * discuss the schema mostly to say they are NOT touching it
 * (「スキーマ変更なし」「スキーマ変更は不要」), so matching 「スキーマ変更」 fired on
 * 54 plans and pointed the wrong way. The ban-sentence sanitizer below cannot
 * catch every such phrasing, which is why the signal is structural instead.
 *
 * The same 114 plans under the current pattern: 32% fire, and every plan that
 * genuinely edits a schema file or migration still does.
 *
 * NOTE: The ban-sentence sanitize step is the user-approved design (task 631
 * Q1 answer: 「禁止文サニタイズを追加(解釈2・推奨)」) — only the data-layer
 * signals are evaluated on sanitized text; every other signal group sees the
 * full text unchanged.
 */
const DATA_RISK_PLAN_RE =
  /(prisma[\/]schema|schema\.prisma|\.prisma\b|migrations?[\/]|prisma\s+(?:db\s+push|migrate\b)|@@(?:index|unique|map)\b|^\s*model\s+[A-Z]\w*\s*\{)/im;

/**
 * Data-layer signals for TASK TEXT, which is prose describing intent rather
 * than quoted code. 「migration を追加する」 is a real signal there, while the
 * same words inside a plan are usually a file listing or a quoted import —
 * hence the split. Task text carries no code, so the ORM-name noise measured
 * in plans does not apply to it.
 */
const DATA_RISK_TEXT_RE = /(prisma|schema\.prisma|migration|migrate|マイグレーション)/i;

/**
 * A sentence segment (bounded by 。 or a newline) that BANS schema changes,
 * e.g. 「Prisma スキーマ変更禁止(再起動を要するため)」「スキーマ変更は不可」.
 * The WHOLE segment is removed so a leading "Prisma" token is stripped too.
 * The {0,10} gap keeps this narrow: a sentence that both touches and bans the
 * schema in distant clauses is left intact (fires — the safe side).
 */
const SCHEMA_BAN_SENTENCE_RE =
  /[^。\n]*(?:スキーマ|schema)[^。\n]{0,10}?(?:禁止|不可|できない|行わない|しないこと)[^。\n]*(?:。|(?=\n)|$)/gi;

/**
 * WEAK signals: words this app's own domain vocabulary collides with (study
 * tasks say 暗号, UI copy says 権限, reviews mention セキュリティ). Measured
 * 38% of tasks premium-forced by contextless matching. Each weak word only
 * fires when its positive-context regex ALSO matches somewhere in the same
 * text (proximity not required — over-firing is the safe side).
 */
const WEAK_SIGNAL_GATES: ReadonlyArray<{ word: RegExp; context: RegExp }> = [
  {
    word: /(暗号|encryption|encrypt|decrypt)/i,
    context: /(鍵|key|復号|ハッシュ|hash|署名|sign|TLS|SSL|証明書|cert|crypto|AES|RSA|実装|修正)/i,
  },
  {
    word: /(権限|permission)/i,
    context: /(auth|rbac|アクセス制御|access\s*control|認可|scope|role|ロール|token)/i,
  },
  {
    word: /(セキュリティ|security)/i,
    context: /(脆弱性|vuln|修正|対策|inject|xss|csrf|サニタイ|escape|patch|漏洩|攻撃|エスケープ)/i,
  },
];

/** Risky file-path markers, matched against plan.md's planned-files section. */
const HIGH_RISK_PATH_RE =
  /(prisma[\\/]schema|migrations?[\\/]|[\\/]auth|payment|billing|security)/i;

/**
 * Whether one body of text signals high-risk work: strong signals fire alone,
 * data-layer signals fire after ban-sentence stripping, weak signals need
 * their context gate. Extracted so task text and plan get identical rules.
 */
function matchesHighRisk(text: string, kind: 'text' | 'plan'): boolean {
  if (STRONG_RISK_RE.test(text)) return true;
  const dataRe = kind === 'plan' ? DATA_RISK_PLAN_RE : DATA_RISK_TEXT_RE;
  if (dataRe.test(text.replace(SCHEMA_BAN_SENTENCE_RE, ' '))) return true;
  return WEAK_SIGNAL_GATES.some((g) => g.word.test(text) && g.context.test(text));
}

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
  /(you'?ve hit your (?:\w+[- ])*(?:spend|usage|rate) limit|claude\.ai\/settings\/usage|codex\/settings\/usage|credit[ _]?balance[ _]?too[ _]?low|quota exceeded|resource_exhausted|rate_limit_error|rate[ _-]limit(?:ed|ing)?|overloaded|(?:http |status )?429|invalid api key|not (?:authenticated|logged in)|では次のフェーズを実行できません|ブロック中のため|ワークフロー無効モード|auto-run stopped|cancelled by user|phase execution timeout|timed out)/i;

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
  if (matchesHighRisk(text, 'text')) {
    return {
      high: true,
      reason: 'task text matches a high-risk domain (data/auth/payment/security)',
    };
  }
  const plan = opts.planContent ?? '';
  if (plan && (matchesHighRisk(plan, 'plan') || HIGH_RISK_PATH_RE.test(plan))) {
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
  const riskFloor: ModelTier | undefined = opts.riskHigh ? 'premium' : undefined;
  const tier = highestTier(roleFloor, retryFloor, themeFloor, riskFloor);

  // Name the STRONGEST contributor — the one that actually set the floor. Ties
  // resolve to the most specific signal (risk > this task's retry > theme >
  // role) so the audit trail points at the rule an operator can act on.
  const candidates: Array<[ModelTier | undefined, string]> = [
    [riskFloor, '高リスク領域(スキーマ/認証/決済/セキュリティ)'],
    [retryFloor, 'このタスクの再試行'],
    [themeFloor, 'テーマの困難度'],
    [roleFloor, `ロール下限(${opts.role})`],
  ];
  const reason = candidates.find(([t]) => t !== undefined && t === tier)?.[1];
  return { tier, reason };
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
