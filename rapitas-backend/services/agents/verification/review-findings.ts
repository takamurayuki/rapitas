/**
 * review-findings
 *
 * Structured juror findings for the adversarial diff review: parsing one
 * juror's `findings[]`, deciding which findings may drive the verdict (the
 * severity + evidence gate), and rendering them as the legacy `reasons[]`
 * strings the repair loop still consumes. Pure; no I/O and no vote counting
 * (that stays in adversarial-diff-review-verdict.ts).
 */
import { FINDING_KINDS, NON_VERDICT_REASON_RE } from './adversarial-diff-review-prompt';
import type { FindingVerification } from './jury-seat-types';

/** How bad one finding is. Only blocker/major can fail the review. */
export type FindingSeverity = 'blocker' | 'major' | 'minor';

/** Kind of defect (closed vocabulary, see FINDING_KINDS in the prompt module). */
export type FindingKind = (typeof FINDING_KINDS)[number];
export { FINDING_KINDS };

/**
 * Whether a finding must stop completion (blocking) or may be deferred to a
 * follow-up concern. Absent means blocking; only follow-up-findings.ts acts on it.
 */
export type FindingImpact = 'blocking' | 'follow_up';

/** Most same-kind counterexamples kept per finding. */
export const MAX_FINDING_EXAMPLES = 10;
const MAX_EXAMPLE_CHARS = 200;

/** One concrete problem a juror reported. */
export interface ReviewFinding {
  severity: FindingSeverity;
  /** What is wrong, in one sentence. */
  summary: string;
  /** Acceptance criterion it violates, normalised to `受入基準N` when numbered. */
  criterion?: string;
  /** Where it shows: `file:line` or the quoted diff hunk. Absent = not evidenced. */
  evidence?: string;
  /** How to reproduce, when the juror gave one. */
  repro?: string;
  /** True when this finding may drive the verdict (blocker/major WITH evidence). */
  gating: boolean;
  /**
   * True for a blocker/major that came without evidence. Kept as a 要確認
   * record for the human, never counted toward fail — the integration policy
   * requires every gating finding to carry its grounds.
   */
  needsCheck?: boolean;
  /** Which juror reported it (set when findings are merged across the panel). */
  juror?: string;
  /** Which seat reported it (two-reviewer form: reviewer-1 / reviewer-2). */
  seatId?: string;
  /**
   * The verifier seat's check of this finding's grounds. Set only on findings
   * that were disputed and sent to the verifier.
   */
  verification?: FindingVerification;
  /** The verifier's one-line reason for `verification`. */
  verificationNote?: string;
  /** Kind of defect, when the juror named one (unknown values read as 'other'). */
  kind?: FindingKind;
  /** Whether it must stop completion. Absent = blocking. A blocker is always blocking. */
  impact?: FindingImpact;
  /** Other inputs/cases of the same kind the diff still gets wrong (≤ 10, one line each). */
  examples?: string[];
  /** Set by splitFollowUp when the finding was moved to a follow-up concern. */
  deferred?: 'follow_up';
}

/**
 * Upper bound on findings STORED per juror / per transition (bounds timeline
 * payload size). Never applied before the verdict is decided — see
 * capFindingsForStorage.
 */
export const MAX_STORED_FINDINGS = 12;

/**
 * Most findings one reply may carry and still be judged. Far above any real
 * panel answer; a longer list is not truncated but rejected as an incomplete
 * reply (see findingsExceedLimit).
 */
export const MAX_PARSED_FINDINGS = 200;

/**
 * Whether a juror's `findings` is too long to judge. Such a reply must be
 * treated as unreadable ('unknown'), never parsed partially: cutting it at
 * the limit dropped a 201st evidenced blocker and passed the work (G2
 * re-review item 3).
 *
 * @param raw - The `findings` value from the juror's JSON / 陪審員JSONの findings
 * @returns True when the list exceeds MAX_PARSED_FINDINGS / 上限超過なら true
 */
export function findingsExceedLimit(raw: unknown): boolean {
  return Array.isArray(raw) && raw.length > MAX_PARSED_FINDINGS;
}

/** Evidence strings that mean "none" even though the field is filled in. */
const EMPTY_EVIDENCE_RE = /^(?:なし|無し|不明|n\/?a|none|null|-+|—+|ー+)$/i;

function normaliseSeverity(raw: unknown): FindingSeverity {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'blocker' || s === 'critical') return 'blocker';
  if (s === 'major' || s === 'high') return 'major';
  return 'minor';
}

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const t = String(raw).trim();
  return t ? t.slice(0, max) : undefined;
}

function normaliseCriterion(raw: unknown): string | undefined {
  const t = text(raw, 80);
  if (!t) return undefined;
  // Jurors write "2", "AC2" or "受入基準2"; non-convergence detection
  // (identifyIndictedCriteria) only recognises the 受入基準N form.
  const m = t.match(/^(?:受入基準|AC|criterion\s*)?\s*(\d+)$/i);
  return m ? `受入基準${m[1]}` : t;
}

function normaliseKind(raw: unknown): FindingKind | undefined {
  if (raw == null) return undefined;
  // NOTE: Compared after lowercasing and trimming only (owner decision for task 1547).
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (FINDING_KINDS as readonly string[]).includes(k) ? (k as FindingKind) : 'other';
}

// Feedback markers are stripped so a juror-written example can never close
// the repair-feedback block early (examples end up in the implementer's verify.md).
const FEEDBACK_MARKER_RE = /<!--\s*repair-feedback:(?:start|end)\s*-->/gi;

function normaliseExamples(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.replace(FEEDBACK_MARKER_RE, '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const clipped = t.slice(0, MAX_EXAMPLE_CHARS);
    if (!out.includes(clipped)) out.push(clipped);
    if (out.length >= MAX_FINDING_EXAMPLES) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Parse a juror's `findings` field. Returns null when the field is not an
 * array, so callers can tell "no findings reported" from "old reply shape".
 *
 * @param raw - The `findings` value from the juror's JSON / 陪審員JSONの findings
 * @returns Normalised findings, or null when absent / 正規化済みの指摘（無ければ null）
 */
export function parseFindings(raw: unknown): ReviewFinding[] | null {
  if (!Array.isArray(raw)) return null;
  // NOTE: Callers must reject over-limit lists first (findingsExceedLimit);
  // the cap below only bounds work and would otherwise drop findings.
  const out: ReviewFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const summary = text(o.summary ?? o.message ?? o.issue ?? o.description, 500);
    if (!summary) continue;
    const severity = normaliseSeverity(o.severity);
    const evidenceRaw = text(o.evidence, 600);
    const evidence = evidenceRaw && !EMPTY_EVIDENCE_RE.test(evidenceRaw) ? evidenceRaw : undefined;
    const serious = severity === 'blocker' || severity === 'major';
    // A note the prompt itself marks as non-decisive (要確認:/管轄外:) never
    // gates, whatever severity the juror attached to it.
    const nonVerdictNote = NON_VERDICT_REASON_RE.test(summary);
    const finding: ReviewFinding = {
      severity,
      summary,
      gating: serious && !!evidence && !nonVerdictNote,
    };
    const criterion = normaliseCriterion(o.criterion);
    if (criterion) finding.criterion = criterion;
    if (evidence) finding.evidence = evidence;
    const repro = text(o.repro, 400);
    if (repro) finding.repro = repro;
    if (serious && !evidence && !nonVerdictNote) finding.needsCheck = true;
    const kind = normaliseKind(o.kind);
    if (kind) finding.kind = kind;
    // NOTE: impact never touches `gating` here — the juror's vote must not
    // change with it, or an impact difference would read as a seat split.
    if (o.impact != null) {
      const followUp =
        typeof o.impact === 'string' && o.impact.trim().toLowerCase() === 'follow_up';
      finding.impact = followUp && severity !== 'blocker' ? 'follow_up' : 'blocking';
    }
    const examples = normaliseExamples(o.examples);
    if (examples) finding.examples = examples;
    out.push(finding);
    if (out.length >= MAX_PARSED_FINDINGS) break;
  }
  return out;
}

function storageRank(f: ReviewFinding): number {
  if (f.gating) return f.severity === 'blocker' ? 0 : 1;
  if (f.needsCheck) return 2;
  return 3;
}

/**
 * Bound a findings list for storage, keeping the ones that decide (or could
 * decide) the verdict first: gating blocker → gating major → 要確認 → the rest,
 * original order within each rank. Only for storage/display; the verdict must
 * already have been computed over the full list.
 *
 * NOTE: A plain `slice(0, 12)` once ran BEFORE the gate, so 12 minor notes
 * followed by one evidenced blocker parsed as pass (G2 review item 3).
 *
 * @param findings - Full findings list / 全指摘
 * @param max - How many to keep / 保持件数
 * @returns At most `max` findings, most decisive first / 重要度順に上限まで
 */
export function capFindingsForStorage(
  findings: ReadonlyArray<ReviewFinding> | undefined,
  max = MAX_STORED_FINDINGS,
): ReviewFinding[] {
  if (!findings) return [];
  if (findings.length <= max) return [...findings];
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => storageRank(a.f) - storageRank(b.f) || a.i - b.i)
    .slice(0, max)
    .map(({ f }) => f);
}

/**
 * Render a finding as a legacy reason string (self-repair feedback, transition
 * metadata). Keeps the `受入基準N:` prefix the non-convergence detector reads.
 *
 * @param f - Finding to render / 表示する指摘
 * @returns One reason line / 理由文字列
 */
export function formatFindingReason(f: ReviewFinding): string {
  const prefix = f.criterion && !f.summary.startsWith(f.criterion) ? `${f.criterion}: ` : '';
  const grounds = f.evidence ? `（根拠: ${f.evidence}）` : '（要確認: 根拠の提示なし）';
  return `${prefix}[${f.severity}] ${f.summary}${grounds}`;
}

/** Numeric 0-100 severity implied by a finding level (used when the juror gave none). */
export function findingSeverityScore(severity: FindingSeverity): number {
  if (severity === 'blocker') return 90;
  if (severity === 'major') return 70;
  return 20;
}
