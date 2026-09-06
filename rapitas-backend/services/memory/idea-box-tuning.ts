/**
 * IdeaBoxTuning
 *
 * Env-tunable thresholds of the idea-box anti-monoculture gates, with the
 * calibration notes that justify each default. Split out of
 * idea-box-service.ts so the service stays within its size baseline.
 * Not responsible for applying the gates (see idea-box-service.ts).
 */

// Theme-saturation gate (anti-monoculture). Embedding cosine (all-MiniLM-L6-v2)
// proved USELESS for Japanese idea similarity (novel ideas scored HIGHER than
// near-dups), so theme-saturation.ts uses a LEXICAL signal: a new idea is rejected
// when its title shares a ≥SALIENT_LEN-char substring with ≥SATURATION_CAP existing
// idea_box entries (the theme is over-represented). Tunable via the env below.
export const SALIENT_LEN = 4;
export const SATURATION_CAP = (() => {
  const v = parseInt(process.env.RAPITAS_IDEA_SATURATION_CAP ?? '8', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
})();

// Near-duplicate gate: reject a brand-new idea whose title is an almost-identical
// re-file of an existing one (character-bigram Jaccard ≥ threshold). Complements
// the saturation cap — saturation caps how MANY same-theme ideas coexist; this
// stops the idea-extractor emitting the SAME idea 2-3× with trivial katakana /
// delimiter variation (observed: "コマンド型ゲートの実体取り込み(SSOT/型ガード/…)" ×3,
// manually pruned every loop tick). Calibrated to 0.45: the observed clones score
// 0.49-0.64 while every distinct facet of a shared theme stays < 0.32 (validated
// against the full 90-idea corpus → 0 false hits), so it does NOT over-reject.
export const NEARDUP_JACCARD = (() => {
  const v = parseFloat(process.env.RAPITAS_IDEA_NEARDUP_JACCARD ?? '0.45');
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.45;
})();
