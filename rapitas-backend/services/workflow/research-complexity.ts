/**
 * research-complexity
 *
 * Extracts the 0-100 complexity score the RESEARCH agent embeds in research.md
 * after actually inspecting the repository. This code-grounded score replaces
 * the a-priori keyword heuristic for model / workflow auto-selection.
 */

/**
 * Parse a 0-100 complexity score from a research report.
 *
 * Accepts the prompted format (`## 複雑度評価` / `スコア: NN`) plus common
 * variants ("複雑度: NN", "complexity: NN", "NN / 100"). Returns null when no
 * valid score is present so callers can fall back to the heuristic.
 *
 * @param markdown - research.md content. / 調査レポート本文
 * @returns Integer 0-100, or null when absent/invalid. / 0-100 または null
 */
export function parseResearchComplexity(markdown: string | null | undefined): number | null {
  if (!markdown) return null;

  const patterns: RegExp[] = [
    // "スコア: 65" / "スコア：65 / 100" (under the 複雑度評価 heading)
    /スコア[\s:：]*?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "複雑度: 65" / "複雑度スコア 65" / "複雑度（0-100）: 65"
    /複雑度[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "complexity: 65" / "complexity score 65"
    /complexity[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
  ];

  for (const re of patterns) {
    const m = markdown.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}
