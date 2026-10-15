/**
 * phase-output-validator-sections
 *
 * Heading-presence check shared by the research / plan / verify validators.
 * Not responsible for content-level honesty checks (see phase-output-validator.ts).
 */
import type { ValidationResult } from './phase-output-validator';

/**
 * Detect which heading texts are present in a markdown document. Looks at
 * level-2 / level-3 headings (## / ###) and considers a section present if
 * any heading contains the keyword (substring match, case-insensitive).
 *
 * Each entry in `required` may be either a single keyword (string) or an
 * OR-group (string[]) where ANY alternative satisfies the requirement.
 * Missing section labels use the first element of an OR-group.
 *
 * @param content - markdown document / マークダウン本文
 * @param required - required section keywords, plain or OR-groups / 必須セクションのキーワード（単一またはOR候補配列）
 * @param label - label for the summary / サマリのラベル
 * @returns validation result / バリデーション結果
 */
export function validateSections(
  content: string,
  required: (string | string[])[],
  label: string,
): ValidationResult {
  if (!content || !content.trim()) {
    return {
      ok: false,
      missingSections: required.map((s) => (Array.isArray(s) ? s[0] : s)),
      severity: 100,
      summary: `${label} is empty`,
    };
  }

  const headingLines = content
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.toLowerCase());
  const headingsBlob = headingLines.join('\n');

  const missingSections: string[] = [];
  for (const section of required) {
    if (Array.isArray(section)) {
      // OR match: any alternative satisfies the requirement
      const found = section.some((alt) => headingsBlob.includes(alt.toLowerCase()));
      if (!found) {
        // Use the first element as the canonical label for reporting
        missingSections.push(section[0]);
      }
    } else {
      if (!headingsBlob.includes(section.toLowerCase())) {
        missingSections.push(section);
      }
    }
  }

  const severity = Math.round((missingSections.length / required.length) * 100);
  return {
    ok: missingSections.length === 0,
    missingSections,
    severity,
    summary:
      missingSections.length === 0
        ? `${label} is well-formed`
        : `${label} missing sections: ${missingSections.join(', ')}`,
  };
}
