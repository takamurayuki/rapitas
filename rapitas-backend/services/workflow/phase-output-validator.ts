/**
 * phase-output-validator
 *
 * Validates that workflow phase artifacts (research.md, plan.md, verify.md)
 * contain the required sections so downstream phases have what they need.
 *
 * If validation fails, the orchestrator can:
 *   - mark the phase as `needs_retry` (force the same role to re-run with
 *     a stricter "you missed sections X / Y / Z" prompt), OR
 *   - escalate to a different agent (e.g. swap codex → claude-code for
 *     planning if codex produced a thin plan).
 *
 * Section requirements are intentionally moderate — we want to catch obvious
 * misses (no "設計判断の根拠" in plan.md) without rejecting cosmetic variation.
 */

export interface ValidationResult {
  ok: boolean;
  /** Section names that were expected but not found. / 不足セクション一覧 */
  missingSections: string[];
  /** Severity score: 0=fine, 100=unusable. / 重大度 */
  severity: number;
  /** Short message for logs / UI. / ログ用要約 */
  summary: string;
}

const RESEARCH_REQUIRED_SECTIONS = ['影響範囲', '依存', '類似実装', 'リスク', 'テスト戦略'];

const PLAN_REQUIRED_SECTIONS = [
  '設計判断の根拠',
  '実装チェックリスト',
  '変更予定ファイル',
  'リスク',
  '完了条件',
];

const VERIFY_REQUIRED_SECTIONS = ['変更ファイル', 'テスト', 'チェックリスト'];

/**
 * Validate research.md content.
 */
export function validateResearch(content: string): ValidationResult {
  return validateSections(content, RESEARCH_REQUIRED_SECTIONS, 'research.md');
}

/**
 * Validate plan.md content. The "設計判断の根拠" section is the most
 * critical — without it, implementers will ask questions or guess.
 */
export function validatePlan(content: string): ValidationResult {
  const result = validateSections(content, PLAN_REQUIRED_SECTIONS, 'plan.md');
  // Up-weight the criticality of "設計判断の根拠"
  if (result.missingSections.includes('設計判断の根拠')) {
    result.severity = Math.max(result.severity, 80);
    result.summary = `${result.summary} | rationale section missing — implementer will likely ask questions`;
    result.ok = false;
  }
  return result;
}

/**
 * Validate verify.md content.
 */
export function validateVerify(content: string): ValidationResult {
  return validateSections(content, VERIFY_REQUIRED_SECTIONS, 'verify.md');
}

/**
 * Detect which heading texts are present in a markdown document. Looks at
 * level-2 / level-3 headings (## / ###) and considers a section present if
 * any heading contains the keyword (substring match, case-insensitive).
 *
 * @param content - markdown document / マークダウン本文
 * @param required - required section keywords / 必須セクションのキーワード
 * @param label - label for the summary / サマリのラベル
 * @returns validation result / バリデーション結果
 */
function validateSections(content: string, required: string[], label: string): ValidationResult {
  if (!content || !content.trim()) {
    return {
      ok: false,
      missingSections: required.slice(),
      severity: 100,
      summary: `${label} is empty`,
    };
  }

  const headingLines = content
    .split(/\r?\n/)
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.toLowerCase());
  const headingsBlob = headingLines.join('\n');

  const missing = required.filter((section) => !headingsBlob.includes(section.toLowerCase()));

  const severity = Math.round((missing.length / required.length) * 100);
  return {
    ok: missing.length === 0,
    missingSections: missing,
    severity,
    summary:
      missing.length === 0
        ? `${label} is well-formed`
        : `${label} missing sections: ${missing.join(', ')}`,
  };
}
