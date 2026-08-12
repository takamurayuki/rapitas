/**
 * concern-value-gate
 *
 * Value gate for concern→task auto-promotion (要求A). Filters open concerns to
 * the ones worth turning into tasks: concrete evidence required, severity at or
 * above a threshold, not part of a lexically saturated theme, and a per-source
 * daily conversion quota (anti log-harvest monoculture). Pure evaluation only —
 * the promoter supplies the DB-derived context (quota counts, saturation
 * predicate) and does the actual task creation.
 */

/** Why a concern was excluded by the value gate (order = evaluation order). */
export type ValueGateRejectReason = 'no_evidence' | 'below_severity' | 'saturated' | 'source_quota';

/** Minimal concern fields the gate evaluates. Structurally satisfied by ConcernEntry. */
export interface ValueGateConcern {
  id: number;
  title: string;
  detail: string;
  severity: string;
  location: string | null;
  originTaskId: number | null;
  /** Origin label ('agent' | 'log_health' | ...); quota is counted per source. */
  source: string;
}

/** Context the promoter supplies to the gate (DB-derived, injected for purity). */
export interface ValueGateContext {
  /** false = gate disabled (toggle OFF) → every concern passes (旧挙動). */
  enabled: boolean;
  /** true when the title belongs to an over-represented lexical theme. */
  isSaturatedTitle: (title: string) => boolean | Promise<boolean>;
  /** Concerns already converted to tasks today (server-local day), per source. */
  convertedTodayBySource: Record<string, number>;
}

/** Gate outcome: admitted concerns plus a per-rejection reason for observability. */
export interface ValueGateResult<T extends ValueGateConcern> {
  passed: T[];
  rejected: Array<{ concern: T; reason: ValueGateRejectReason }>;
}

// NOTE: Mirrors CONCERN_SEVERITIES in concern-backlog-service.ts (index = rank,
// lower = more severe). Duplicated locally so this module stays import-free of
// the DB-backed service (keeps it pure and safe under bun's whole-module mocks).
const SEVERITY_ORDER = ['urgent', 'high', 'medium', 'low'] as const;

/** Severity → rank (0 = most severe). Unknown values rank as 'medium' (mirrors normalizeConcernSeverity). */
function severityRank(severity: string): number {
  const idx = SEVERITY_ORDER.indexOf(severity as (typeof SEVERITY_ORDER)[number]);
  return idx >= 0 ? idx : SEVERITY_ORDER.indexOf('medium');
}

/**
 * Minimum severity that passes the gate (env-tunable, default 'medium').
 * Invalid values fall back to the default (same stance as CONCERN_NEARDUP_JACCARD).
 *
 * @returns Severity threshold / 合格に必要な最低severity
 */
export function resolveMinSeverity(): string {
  const v = process.env.RAPITAS_CONCERN_VALUE_MIN_SEVERITY?.trim().toLowerCase();
  return v && (SEVERITY_ORDER as readonly string[]).includes(v) ? v : 'medium';
}

/**
 * Per-source daily conversion cap (env-tunable, default 2).
 * Invalid or non-positive values fall back to the default.
 *
 * @returns Max conversions per source per local day / source別の1日あたり起票上限
 */
export function resolveSourceDailyCap(): number {
  const v = parseInt(process.env.RAPITAS_CONCERN_SOURCE_DAILY_CAP ?? '2', 10);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

/**
 * Start of the current day in SERVER-LOCAL time (0:00), the quota's day
 * boundary — matches the operator's calendar day, not UTC.
 *
 * @param now - Reference instant (defaults to now) / 基準時刻
 * @returns Local midnight of `now`'s day / その日のローカル0時
 */
export function localDayStart(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// Evidence patterns (要求A.1: ログ抜粋/CI run/task番号/再現手順のいずれか).
// Deliberately BROAD — a false negative silently starves the whole promotion
// loop, so anything that plausibly anchors the concern to a concrete artifact
// counts (file:line, #task, URL, repro heading, code fence, location field).
const FILE_LINE_RE = /[\w./\\-]+\.[A-Za-z0-9]+:\d+/;
const TASK_REF_RE = /#\d+/;
const URL_RE = /https?:\/\/\S+/;
const REPRO_HEADING_RE = /再現手順|repro|steps to reproduce/i;
const CODE_FENCE = '```';

/**
 * Whether a concern carries a concrete evidence reference (file:line, task
 * number, URL, repro steps, code fence, or a non-empty location field).
 *
 * @param concern - Concern to inspect / 判定対象の懸念
 * @returns true when any evidence pattern matches / 証拠参照があれば true
 */
export function hasEvidenceReference(
  concern: Pick<ValueGateConcern, 'detail' | 'location' | 'originTaskId'>,
): boolean {
  if (concern.originTaskId != null) return true;
  if (concern.location != null && concern.location.trim() !== '') return true;
  const text = concern.detail ?? '';
  return (
    FILE_LINE_RE.test(text) ||
    TASK_REF_RE.test(text) ||
    URL_RE.test(text) ||
    REPRO_HEADING_RE.test(text) ||
    text.includes(CODE_FENCE)
  );
}

/**
 * Evaluate the value gate over a batch of candidate concerns. Checks are
 * applied in a fixed order per concern (evidence → severity → saturation →
 * source quota); the FIRST failing check names the rejection reason. The quota
 * counts today's already-converted concerns PLUS concerns admitted earlier in
 * this same batch, so one call can never over-admit a source.
 *
 * @param concerns - Candidates in promotion-preference order / 候補（優先順）
 * @param ctx - Toggle, saturation predicate, and today's per-source counts / ゲート文脈
 * @returns Admitted concerns and per-concern rejection reasons / 合否と理由
 */
export async function evaluateConcernValueGate<T extends ValueGateConcern>(
  concerns: T[],
  ctx: ValueGateContext,
): Promise<ValueGateResult<T>> {
  if (!ctx.enabled) return { passed: [...concerns], rejected: [] };

  const cap = resolveSourceDailyCap();
  const minRank = severityRank(resolveMinSeverity());
  const adoptedBySource: Record<string, number> = {};
  const passed: T[] = [];
  const rejected: Array<{ concern: T; reason: ValueGateRejectReason }> = [];

  for (const concern of concerns) {
    if (!hasEvidenceReference(concern)) {
      rejected.push({ concern, reason: 'no_evidence' });
      continue;
    }
    if (severityRank(concern.severity) > minRank) {
      rejected.push({ concern, reason: 'below_severity' });
      continue;
    }
    if (await ctx.isSaturatedTitle(concern.title)) {
      rejected.push({ concern, reason: 'saturated' });
      continue;
    }
    const source = concern.source || 'unknown';
    const used = (ctx.convertedTodayBySource[source] ?? 0) + (adoptedBySource[source] ?? 0);
    if (used >= cap) {
      rejected.push({ concern, reason: 'source_quota' });
      continue;
    }
    adoptedBySource[source] = (adoptedBySource[source] ?? 0) + 1;
    passed.push(concern);
  }

  return { passed, rejected };
}
