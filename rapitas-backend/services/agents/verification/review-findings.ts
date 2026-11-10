/**
 * review-findings
 *
 * Structured juror findings for the adversarial diff review: parsing one
 * juror's `findings[]`, deciding which findings may drive the verdict (the
 * severity + evidence gate), and rendering them as the legacy `reasons[]`
 * strings the repair loop still consumes. Pure; no I/O and no vote counting
 * (that stays in adversarial-diff-review-verdict.ts).
 */
import { NON_VERDICT_REASON_RE } from './adversarial-diff-review-prompt';

/** How bad one finding is. Only blocker/major can fail the review. */
export type FindingSeverity = 'blocker' | 'major' | 'minor';

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
}

/** Upper bound on findings kept per juror (bounds timeline payload size). */
const MAX_FINDINGS = 12;

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

/**
 * Parse a juror's `findings` field. Returns null when the field is not an
 * array, so callers can tell "no findings reported" from "old reply shape".
 *
 * @param raw - The `findings` value from the juror's JSON / 陪審員JSONの findings
 * @returns Normalised findings, or null when absent / 正規化済みの指摘（無ければ null）
 */
export function parseFindings(raw: unknown): ReviewFinding[] | null {
  if (!Array.isArray(raw)) return null;
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
    out.push(finding);
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
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
