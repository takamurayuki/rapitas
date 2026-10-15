/**
 * verify-evidence-similarity
 *
 * Decides whether two quoted verifier findings are the SAME finding. Pure: no
 * database, no clock, no policy about what to do with the answer.
 *
 * Why similarity rather than equality. verify-repeat-evidence compared repeat
 * keys with `===`, so a verifier that reworded the identical row each round was
 * never recognised. Measured 2026-10-13: of the 14 tasks with 2+ verify_repair
 * bounces since the cutoff machinery landed, the criterion path would fire on 2
 * and the exact-evidence path on 1 — neither fired on 11.
 *
 * Why not normalisation. Dropping digits, paths and padding was tried first and
 * measured to change NOTHING: distinct keys 5 -> 5 on #1168, firing tasks
 * 1 -> 1 overall. The differences are word-level — "Resource not found" against
 * "HTTP 404（Resource not found）", "結果もない" against "結果がない" — which no
 * amount of token stripping touches.
 *
 * Why character bigrams. Japanese has no word separators, so word tokenisation
 * is unavailable; the Dice coefficient over character bigrams needs no lexicon
 * and is stable against insertions of the kind measured above.
 *
 * Where the threshold comes from. Measured over every recorded key pair:
 *
 *   same finding, reworded   0.924 (#1168 b2~b3), 0.863 (#1105), 0.758 (#1168 b4~b5)
 *   different tasks          0.497 at most, across 465 pairs
 *
 * 0.85 sits in that gap with 0.35 of margin above the worst cross-task pair,
 * and matched 0 of the 465. A false cutoff — stopping a task that is
 * progressing — is the failure this module must avoid above all, so the margin
 * is the safety argument, not the count of repeats.
 */

/** Dice score above which two findings count as the same one. */
export const EVIDENCE_SIMILARITY_THRESHOLD = 0.85;

/** Character bigrams of a whitespace-collapsed, case-folded string. */
function bigrams(text: string): Set<string> {
  const compact = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const grams = new Set<string>();
  for (let i = 0; i < compact.length - 1; i++) grams.add(compact.slice(i, i + 2));
  return grams;
}

/**
 * Dice coefficient of two findings' character bigrams: 2|A∩B| / (|A|+|B|).
 *
 * Strings too short to form a bigram (0 or 1 character) fall back to equality,
 * which keeps the function total rather than returning NaN.
 *
 * @param a - One quoted finding / 引用証拠その1
 * @param b - The other / 引用証拠その2
 * @returns 1 for identical, 0 for nothing shared / 1=同一, 0=共通なし
 */
export function evidenceSimilarity(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.size === 0 || right.size === 0) {
    return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim() ? 1 : 0;
  }
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared++;
  return (2 * shared) / (left.size + right.size);
}

/**
 * Whether two quoted findings are the same finding.
 *
 * Strictly wider than the `===` it replaces: an identical pair scores 1 and so
 * always qualifies.
 *
 * @param a - One quoted finding / 引用証拠その1
 * @param b - The other / 引用証拠その2
 * @returns Whether they should be counted as one finding / 同一指摘と数えるか
 */
export function isSameFinding(a: string, b: string): boolean {
  return evidenceSimilarity(a, b) >= EVIDENCE_SIMILARITY_THRESHOLD;
}
