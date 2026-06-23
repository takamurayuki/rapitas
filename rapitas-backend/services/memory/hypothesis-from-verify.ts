/**
 * hypothesis-from-verify
 *
 * Closes the hypothesis loop with REAL verification: parse a `## 仮説評価`
 * (Hypothesis Evaluation) section out of a saved verify.md, where the verifier
 * explicitly judged whether each open hypothesis's PREDICTION held, and graduate
 * (成立 → validated) or refute (不成立 → rejected) it decisively. This replaces
 * the weak "the task completed → +0.25" signal (which never crossed the 0.8
 * graduation bar from a single completion-evidence, leaving the ledger permanently
 * 検証待ち) with an explicit, falsifiable verdict. Not responsible for forming
 * hypotheses (see hypothesis-from-research) or injecting them (see
 * workflow-hypothesis-context).
 */
import { createLogger } from '../../config/logger';
import { addEvidence } from './hypothesis-service';

const log = createLogger('memory:hypothesis-from-verify');

/** Parsed verdict for one hypothesis from a verify.md `## 仮説評価` section. */
export interface HypothesisVerdict {
  hypothesisId: number;
  verdict: 'confirmed' | 'refuted';
  /** The verifier's reason / evidence text (for the evidence detail). / 根拠テキスト */
  reason: string;
}

// 成立 / confirmed / 立証 / ✓ → the prediction held. 不成立 / refuted / 反証 / ✗ →
// it did not. Anything else (保留 / 不明 / inconclusive) is intentionally ignored
// so an uncertain verifier leaves the hypothesis open rather than forcing a verdict.
const CONFIRM_RE = /(成立|確認|立証|confirmed|holds?|true|✓|✔)/i;
const REFUTE_RE = /(不成立|反証|否定|refuted|false|✗|✘|×)/i;

/**
 * Extract per-hypothesis verdicts from a verify.md `## 仮説評価` section.
 * Lines look like `- [#2854] 成立: 正規表現で7resolver生成できた` or
 * `- #2931 不成立 — X が想定と異なった`. The `#id` anchor is required (it maps the
 * verdict back to a ledger entry); a line without one is skipped.
 *
 * @param content - verify.md body / verify.md 本文
 * @returns Parsed verdicts (confirmed/refuted only) / 抽出した判定
 */
export function extractHypothesisVerdicts(content: string | null | undefined): HypothesisVerdict[] {
  if (!content) return [];
  const out: HypothesisVerdict[] = [];
  const seen = new Set<number>();
  let inSection = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // A heading whose text starts with 仮説評価 / hypothesis eval opens the section.
    if (/^#{1,6}\s*(仮説評価|仮説の?評価|hypothesis\s*eval)/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line)) break; // next heading closes it
    if (!inSection) continue;
    const m = line.match(/^[-*]\s*\[?#(\d+)\]?\s*(.+)$/);
    if (!m) continue;
    const hypothesisId = Number(m[1]);
    if (!Number.isFinite(hypothesisId) || seen.has(hypothesisId)) continue;
    const rest = (m[2] ?? '').trim();
    // Refutation takes precedence so a line mentioning both ("成立しない=不成立")
    // is not mis-read as confirmed.
    let verdict: 'confirmed' | 'refuted' | null = null;
    if (REFUTE_RE.test(rest)) verdict = 'refuted';
    else if (CONFIRM_RE.test(rest)) verdict = 'confirmed';
    if (!verdict) continue;
    seen.add(hypothesisId);
    out.push({ hypothesisId, verdict, reason: rest.slice(0, 300) });
  }
  return out;
}

/**
 * Apply explicit hypothesis verdicts parsed from a verify.md. Each verdict is a
 * DECISIVE piece of evidence, so a confirmed hypothesis graduates to validated and
 * a refuted one is rejected in a single call. Best-effort: never throws (a parse /
 * DB hiccup must not fail the verify save).
 *
 * @param taskId - Task whose verify.md produced these verdicts / 検証元タスク
 * @param content - verify.md body / verify.md 本文
 * @returns Count of verdicts applied / 適用した判定数
 */
export async function applyHypothesisVerdictsFromVerify(
  taskId: number,
  content: string | null | undefined,
): Promise<number> {
  const verdicts = extractHypothesisVerdicts(content);
  if (verdicts.length === 0) return 0;

  let applied = 0;
  for (const v of verdicts) {
    try {
      const res = await addEvidence(v.hypothesisId, {
        stance: v.verdict === 'confirmed' ? 'for' : 'against',
        detail:
          v.verdict === 'confirmed'
            ? `verify で予測の的中を確認: ${v.reason}`
            : `verify で予測の不成立を確認: ${v.reason}`,
        // Concrete artifact (has '#' + digits + ':') so the evidence gate accepts it.
        artifact: `task#${taskId}:verify-verdict`,
        taskId,
        phase: 'verify',
        decisive: true,
      });
      if (res.ok) applied += 1;
    } catch (err) {
      log.warn({ err, taskId, hypothesisId: v.hypothesisId }, '[hypothesis-from-verify] addEvidence failed');
    }
  }
  if (applied > 0) {
    log.info({ taskId, applied }, '[hypothesis-from-verify] applied explicit verdicts');
  }
  return applied;
}
