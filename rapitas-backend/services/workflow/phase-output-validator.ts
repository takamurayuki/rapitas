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

const VERIFY_REQUIRED_SECTIONS = ['テスト結果', 'チェックリスト', '検証結果サマリ'];

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
 *
 * In addition to the structural section check, look for the contradiction
 * pattern where the report says "全テスト通過 / all tests pass" but the
 * embedded test summary indicates `failed` / `exit 1` / `× N tests`. The
 * agent has been observed hallucinating a "全12テスト通過" claim while
 * the implementer's changes actually broke 10 tests (gemini-2.5-flash
 * verifier, observed in production). When that contradiction is
 * detected, return `ok=false` with severity=80 so the orchestrator's
 * existing "treat as failed when validation fails" branch fires.
 *
 * @param content - verify.md body / verify.md 本文
 * @returns Validation result with contradiction details when applicable
 */
export function validateVerify(content: string): ValidationResult {
  const sectionResult = validateSections(content, VERIFY_REQUIRED_SECTIONS, 'verify.md');
  if (!sectionResult.ok) return sectionResult;

  const lower = content.toLowerCase();
  const claimsAllPass =
    /全[テt]?\d*\s*テスト[^❌]{0,30}通過|all\s+tests?\s+pass|all\s+\d+\s+tests?\s+passed|✅\s*検証成功|✅\s*pass/i.test(
      content,
    ) || /すべて(?:の)?テスト[^❌]{0,40}(成功|通過|パス)/.test(content);
  const failureSignals = [
    /\b(\d+)\s+failed/i,
    /tests?\s+\d+\s+failed/i,
    /test\s+files?[\s\S]{0,80}failed/i,
    /failing\s+test/i,
    /テスト[^。\n]{0,30}失敗/,
    /失敗\s*(?:した)?テスト/,
    /❌/,
    /exit\s*(code\s*)?[:=]?\s*1\b/i,
    /exit\s*1\b/i,
    /×\s*\d+/,
  ];
  const failureHits = failureSignals
    .map((re) => content.match(re))
    .filter((m): m is RegExpMatchArray => !!m);

  if (claimsAllPass && failureHits.length > 0) {
    const evidence = failureHits
      .map((m) => m[0])
      .slice(0, 3)
      .join(' | ');
    return {
      ok: false,
      missingSections: [],
      severity: 80,
      summary:
        `verify.md self-contradicts: claims all tests pass while body contains failure signals (${evidence}). ` +
        `Verifier likely hallucinated success — re-run with stricter test-honesty prompt.`,
    };
  }

  // Detect the explicit "tests did not complete" or "❌" mark — surface
  // as a soft failure so the workflow does not silently auto-PR a
  // broken implementation.
  if (/❌\s*検証失敗|❌\s*verification\s*fail|verify[: ]\s*fail/i.test(lower)) {
    return {
      ok: false,
      missingSections: [],
      severity: 90,
      summary: 'verify.md explicitly marks the verification as failed.',
    };
  }

  return sectionResult;
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
