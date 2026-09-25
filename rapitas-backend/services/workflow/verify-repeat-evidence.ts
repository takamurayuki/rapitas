/**
 * verify-repeat-evidence
 *
 * Pure helpers that let the repair loop notice it is being handed the SAME
 * verifier finding round after round. The criterion-based detector in
 * verify-convergence.ts keys on acceptance-criterion numbers and file tokens;
 * the validator's own rejections ("self-contradicts (❌)", "partial verdict")
 * carry neither, so a verifier that rewrote the identical ❌ row every round
 * was never cut off (task 914: 16 bounces on one plan item whose test file
 * does not exist on Windows; task 973: 10 identical ⚠️ sets). Not responsible
 * for DB access — the budget module feeds it prior reasons.
 */

/** Delimiters the validator wraps quoted evidence lines in. */
const EVIDENCE_OPEN = '«';
const EVIDENCE_CLOSE = '»';

/** Longest slice of a verify.md line that gets quoted into a reason. */
const MAX_QUOTED_LINE = 120;

/**
 * Normalise one verify.md line for quoting: collapse whitespace, drop table
 * pipes at the edges, cap the length. Two rounds that differ only in
 * whitespace or column padding must compare equal.
 *
 * @param line - Raw verify.md line / verify.md の1行
 * @returns Quoted evidence token, or '' when the line is blank / 引用トークン
 */
export function quoteEvidenceLine(line: string): string {
  const compact = line
    .replace(/[«»]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*\|\s*/, '')
    .replace(/\s*\|\s*$/, '')
    .trim()
    .slice(0, MAX_QUOTED_LINE);
  return compact ? `${EVIDENCE_OPEN}${compact}${EVIDENCE_CLOSE}` : '';
}

/**
 * Extract the repeat key of a repair reason: every quoted evidence segment,
 * in order. Reasons without quoted evidence (older rows, judge verdicts,
 * generic fallbacks) yield null so they can never be counted as "identical".
 *
 * @param reason - Repair-bounce reason text / 差し戻し理由
 * @returns Joined evidence key, or null / 証拠キー
 */
export function extractRepeatKey(reason: string): string | null {
  const parts: string[] = [];
  const re = /«([^»]*)»/g;
  for (const m of reason.matchAll(re)) {
    const p = m[1].trim();
    if (p) parts.push(p);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

/** Verdict of the identical-evidence check. */
export interface RepeatedEvidenceVerdict {
  /** True when the same quoted evidence has been handed back threshold+ times. */
  cutoff: boolean;
  /** The repeated evidence key (when cutoff). */
  repeatedEvidence?: string;
  /** How many reasons (current included) carried it (when cutoff). */
  count?: number;
}

/**
 * Decide whether the current rejection is the same finding the implementer
 * has already been bounced for `threshold - 1` times in this repair window.
 * Only reasons carrying quoted evidence take part; everything else fails
 * open, because a generic reason repeated three times says nothing about
 * whether the underlying finding changed.
 *
 * @param currentReason - Reason about to trigger a bounce / 今回の理由
 * @param priorReasons - Reasons of prior bounces in the window / 過去の理由
 * @param threshold - Occurrences (current included) that mean treading water / 閾値
 * @returns Verdict / 判定
 */
export function detectRepeatedEvidence(
  currentReason: string,
  priorReasons: string[],
  threshold: number,
): RepeatedEvidenceVerdict {
  const key = extractRepeatKey(currentReason);
  if (!key || threshold < 1) return { cutoff: false };
  let count = 1;
  for (const prior of priorReasons) {
    if (extractRepeatKey(prior) === key) count++;
  }
  if (count < threshold) return { cutoff: false };
  return { cutoff: true, repeatedEvidence: key, count };
}
