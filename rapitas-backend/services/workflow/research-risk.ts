/**
 * research-risk
 *
 * Extracts the structured RISK verdict the research agent embeds in research.md
 * after actually inspecting the repository. Sibling of research-complexity.ts:
 * the same "code-grounded assessment supersedes the a-priori keyword guess"
 * principle, applied to the risk floor instead of the complexity score.
 *
 * Not responsible for deciding the model tier — only for reading the verdict.
 */

const AREA_WORDS: ReadonlyArray<{ key: string; probe: RegExp }> = [
  { key: 'schema', probe: /スキーマ|schema|マイグレーション|migration/i },
  { key: 'auth', probe: /認証|認可|auth/i },
  { key: 'payment', probe: /決済|課金|payment|billing/i },
  { key: 'security', probe: /セキュリティ|security|脆弱性|vuln/i },
];

/** A research agent's own risk judgement. */
export interface ResearchRiskVerdict {
  /** True when the agent judged the work to touch a high-risk area. */
  high: boolean;
  /** Normalised area keys it named (empty for a `低` verdict). */
  areas: string[];
}

/**
 * Parse the `## リスク判定` block from a research report.
 *
 * The block is prompted as `リスク: 高|低` plus an optional `対象領域:` line.
 * Returns null when the section is absent or unparseable, so callers fall back
 * to the keyword detector rather than silently treating unknown as safe.
 *
 * @param markdown - research.md content. / 調査レポート本文
 * @returns The verdict, or null when not present. / 判定、無ければ null
 */
export function parseResearchRisk(markdown: string | null | undefined): ResearchRiskVerdict | null {
  if (!markdown) return null;

  // Only read INSIDE the リスク判定 section: the rest of a research report
  // quotes code and prior findings, which is exactly the prose noise this
  // module exists to stop trusting.
  // NOTE: no `m` flag. With it `$` means end-of-LINE, so the lazy body match
  // terminated on the verdict line itself and 対象領域 was never read.
  const section = markdown.match(
    /(?:^|\n)#{1,4}\s*(?:リスク判定|リスク評価|risk assessment)[^\n]*\n([\s\S]{0,600}?)(?=\n#{1,4}\s|$)/i,
  );
  if (!section) return null;
  const body = section[1];

  const verdict = body.match(/リスク[\s:：]*?(高|低|high|low)/i);
  if (!verdict) return null;
  const token = verdict[1].toLowerCase();
  const high = token === '高' || token === 'high';

  if (!high) return { high: false, areas: [] };

  const areaLine = body.match(/(?:対象領域|領域|areas?)[\s:：]*([^\n]*)/i);
  const areaText = areaLine ? areaLine[1] : body;
  const areas = AREA_WORDS.filter((a) => a.probe.test(areaText)).map((a) => a.key);
  return { high: true, areas };
}
