/**
 * reviewHistory
 *
 * Converts raw timeline events (GET /memory/timeline) into the display model
 * for the task's verification history: MEASURED checks (`verification_measured`,
 * the automated verifier's real lint/type/test run) and the independent JURY
 * review (`adversarial_review`, with structured findings), including the
 * two-reviewer form (seats by role, the verifier seat's check of disputed
 * findings, and a human wait), plus resolutions of a review hold
 * (`review_hold_resolved`). Pure data transformation only — no fetching or
 * rendering.
 */

/** One row of GET /memory/timeline (payload already JSON-parsed by the API). */
export interface RawTimelineEvent {
  id?: number | string | null;
  eventType?: string | null;
  payload?: unknown;
  createdAt?: string | null;
}

export type FindingSeverity = 'blocker' | 'major' | 'minor';

/** One jury finding, ready for display. */
export interface DisplayFinding {
  severity: FindingSeverity;
  summary: string;
  criterion: string | null;
  evidence: string | null;
  repro: string | null;
  juror: string | null;
  /** True when it decided the verdict (blocker/major with evidence). */
  gating: boolean;
  /** True for a serious finding recorded without evidence (要確認). */
  needsCheck: boolean;
  /** Seat that reported it (two-reviewer form): reviewer-1 / reviewer-2. */
  seatId: string | null;
  /** The verifier seat's check, set only on disputed findings. */
  verification: FindingVerification | null;
  verificationNote: string | null;
}

export type FindingVerification = 'holds' | 'refuted' | 'undetermined';

/** One seat of a two-reviewer review. */
export interface DisplaySeat {
  seatId: string;
  role: 'reviewer' | 'verifier';
  verdict: string;
  model: string | null;
  unknownReason: string | null;
}

/** Why a review waits for a human (review hold). */
export interface AwaitingHuman {
  reason: 'jury_unavailable_high_risk' | 'unresolved_dispute' | 'ineligible_verifier';
  detail: string;
}

/** One production jury review. */
export interface JuryReviewEntry {
  id: string;
  verdict: 'pass' | 'fail' | 'unknown' | 'hold';
  /** 'two_seat' for the two-reviewer form; 'legacy' for older panel votes. */
  form: 'two_seat' | 'legacy';
  /** Seats by role (empty for legacy reviews). */
  seats: DisplaySeat[];
  /** Set when the review was handed to a human. */
  awaitingHuman: AwaitingHuman | null;
  severity: number | null;
  findings: DisplayFinding[];
  /** Reasons from reviews recorded before structured findings existed. */
  legacyReasons: string[];
  jurorCount: number;
  judgedCount: number;
  createdAt: string | null;
}

export type CheckStatus = 'ok' | 'ng' | 'skipped' | 'unverifiable';

/** One measured verification run. */
export interface MeasuredEntry {
  id: string;
  outcome: 'pass' | 'fail' | 'unverifiable';
  checks: Array<{ name: string; status: CheckStatus; errorCount: number }>;
  createdAt: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function toSeverity(v: unknown): FindingSeverity {
  return v === 'blocker' || v === 'major' ? v : 'minor';
}

function toFinding(raw: unknown): DisplayFinding | null {
  const o = asRecord(raw);
  const summary = o && str(o.summary);
  if (!o || !summary) return null;
  return {
    severity: toSeverity(o.severity),
    summary,
    criterion: str(o.criterion),
    evidence: str(o.evidence),
    repro: str(o.repro),
    juror: str(o.juror),
    gating: o.gating === true,
    needsCheck: o.needsCheck === true,
    seatId: str(o.seatId),
    verification:
      o.verification === 'holds' ||
      o.verification === 'refuted' ||
      o.verification === 'undetermined'
        ? o.verification
        : null,
    verificationNote: str(o.verificationNote),
  };
}

function toSeat(raw: unknown): DisplaySeat | null {
  const o = asRecord(raw);
  const seatId = o && str(o.seatId);
  if (!o || !seatId) return null;
  return {
    seatId,
    role: o.role === 'verifier' ? 'verifier' : 'reviewer',
    verdict: str(o.verdict) ?? 'unknown',
    model: str(o.model),
    unknownReason: str(o.unknownReason),
  };
}

function toAwaitingHuman(raw: unknown): AwaitingHuman | null {
  const o = asRecord(raw);
  if (!o) return null;
  const reason =
    o.reason === 'unresolved_dispute' ||
    o.reason === 'jury_unavailable_high_risk' ||
    o.reason === 'ineligible_verifier'
      ? o.reason
      : null;
  return reason ? { reason, detail: str(o.detail) ?? '' } : null;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocker: 0, major: 1, minor: 2 };

/** Oldest first, matching the transition-based critic history above it. */
function chronological<T extends { createdAt: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Normalise `adversarial_review` timeline events into display entries,
 * tolerating events recorded before findings existed (reasons only).
 *
 * @param events - Rows from GET /memory/timeline / タイムラインの行
 * @returns Jury entries, oldest first / 陪審の判定（古い順）
 */
export function deriveJuryReviewHistory(events: RawTimelineEvent[]): JuryReviewEntry[] {
  const out: JuryReviewEntry[] = [];
  events.forEach((ev, index) => {
    if (ev.eventType !== 'adversarial_review') return;
    const p = asRecord(ev.payload);
    if (!p) return;
    const verdict =
      p.verdict === 'pass' || p.verdict === 'fail' || p.verdict === 'hold' ? p.verdict : 'unknown';
    const form = p.form === 'two_seat' ? 'two_seat' : 'legacy';
    const seats = (Array.isArray(p.seats) ? p.seats : [])
      .map(toSeat)
      .filter((x): x is DisplaySeat => x !== null);
    // The verifier does not vote, so "who judged" counts reviewer seats only.
    const jurors = (Array.isArray(p.jurors) ? p.jurors.map(asRecord).filter(Boolean) : []).filter(
      (j) => j!.role !== 'verifier',
    );
    const findings = (Array.isArray(p.findings) ? p.findings : [])
      .map(toFinding)
      .filter((f): f is DisplayFinding => f !== null)
      // Findings that decided the verdict first; an unevidenced "blocker"
      // (要確認, not counted) must not read as the headline problem.
      .sort(
        (a, b) =>
          Number(b.gating) - Number(a.gating) ||
          SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
      );
    const legacyReasons =
      findings.length > 0 || Array.isArray(p.findings)
        ? []
        : [
            ...new Set(
              jurors.flatMap((j) =>
                Array.isArray(j!.reasons)
                  ? j!.reasons.filter((r): r is string => typeof r === 'string')
                  : [],
              ),
            ),
          ];
    out.push({
      id: `jury-${ev.id ?? index}`,
      verdict,
      form,
      seats,
      awaitingHuman: verdict === 'hold' ? toAwaitingHuman(p.awaitingHuman) : null,
      severity: typeof p.severity === 'number' ? p.severity : null,
      findings,
      legacyReasons,
      jurorCount: jurors.length,
      judgedCount: jurors.filter((j) => j!.verdict === 'pass' || j!.verdict === 'fail').length,
      createdAt: ev.createdAt ?? null,
    });
  });
  return chronological(out);
}

/**
 * Normalise `verification_measured` timeline events into display entries.
 *
 * @param events - Rows from GET /memory/timeline / タイムラインの行
 * @returns Measured runs, oldest first / 実測の記録（古い順）
 */
export function deriveMeasuredHistory(events: RawTimelineEvent[]): MeasuredEntry[] {
  const out: MeasuredEntry[] = [];
  events.forEach((ev, index) => {
    if (ev.eventType !== 'verification_measured') return;
    const result = asRecord(asRecord(ev.payload)?.result);
    if (!result || !Array.isArray(result.checks)) return;
    const checks = result.checks
      .map(asRecord)
      .filter((c): c is Record<string, unknown> => !!c && typeof c.name === 'string')
      .map((c) => ({
        name: c.name as string,
        status: (c.unverifiable === true
          ? 'unverifiable'
          : c.ran !== true
            ? 'skipped'
            : c.ok === true
              ? 'ok'
              : 'ng') as CheckStatus,
        errorCount: typeof c.errorCount === 'number' ? c.errorCount : 0,
      }));
    out.push({
      id: `measured-${ev.id ?? index}`,
      outcome: result.unverifiable === true ? 'unverifiable' : result.ok === true ? 'pass' : 'fail',
      checks,
      createdAt: ev.createdAt ?? null,
    });
  });
  return chronological(out);
}

/** One human resolution of a review hold. */
export interface ReviewHoldResolutionEntry {
  id: string;
  action: 'accept' | 'override';
  resolvedBy: string | null;
  note: string | null;
  createdAt: string | null;
}

/**
 * Normalise `review_hold_resolved` timeline events.
 *
 * @param events - Rows from GET /memory/timeline / タイムラインの行
 * @returns Resolutions, oldest first / 保留の解消（古い順）
 */
export function deriveReviewHoldResolutions(
  events: RawTimelineEvent[],
): ReviewHoldResolutionEntry[] {
  const out: ReviewHoldResolutionEntry[] = [];
  events.forEach((ev, index) => {
    if (ev.eventType !== 'review_hold_resolved') return;
    const p = asRecord(ev.payload);
    if (!p || (p.action !== 'accept' && p.action !== 'override')) return;
    out.push({
      id: `hold-resolved-${ev.id ?? index}`,
      action: p.action,
      resolvedBy: str(p.resolvedBy),
      note: str(p.note),
      createdAt: ev.createdAt ?? null,
    });
  });
  return chronological(out);
}
