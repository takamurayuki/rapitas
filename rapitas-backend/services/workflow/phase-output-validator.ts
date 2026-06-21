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

// NOTE: '類似機能' is the current template heading; '類似実装' is accepted for backward compatibility.
const RESEARCH_REQUIRED_SECTIONS: (string | string[])[] = [
  '影響範囲',
  '依存',
  ['類似機能', '類似実装'],
  'リスク',
  'テスト戦略',
];

const PLAN_REQUIRED_SECTIONS = [
  '設計判断の根拠',
  '実装チェックリスト',
  '変更予定ファイル',
  'リスク',
  '完了条件',
];

// OR-group: any of the listed headings satisfies the 検証結果サマリ requirement
const VERIFY_REQUIRED_SECTIONS: (string | string[])[] = [
  'テスト結果',
  'チェックリスト',
  ['検証結果サマリ', '検証結果', '検証サマリ', '総合評価', '実装結果検証', '検証レポート'],
];

/**
 * Patterns that NEVER appear in a legitimate workflow artifact — their presence
 * means the agent's streamed execution log / stream-json leaked into the md
 * (a "broken" file). Any single match flags pollution.
 */
const HARD_NOISE_PATTERNS: RegExp[] = [
  /\[System:\s*(?:init|thinking_tokens)\]/i,
  /\[Claude Code\]\s*(?:Starting execution|Working directory|Process PID|Timeout|Prompt:)/i,
  /^\s*\[Result:\s*\w+/im,
  /^\s*\{"type":\s*"/m, // stream-json event
  /^\s*data:\s*\{/m, // SSE frame
  // eslint-disable-next-line no-control-regex
  /\[[0-9;]*m/, // ANSI color escape
];

/**
 * Agent-log line shapes that occasionally appear legitimately (e.g. quoted in a
 * report), so they only flag pollution in QUANTITY.
 */
const SOFT_NOISE_LINE =
  /^\s*\[(?:Tool|Tool Done|Tool Error|Command|エージェント|実行開始|継続実行|System Error|調査完了|計画作成完了|実装完了|検証完了|フェーズ完了)\b/i;

/**
 * Whether an md is "broken" by agent log / stream output leaking into it. Used
 * to stop a corrupted research/plan/verify from being accepted, auto-approved,
 * reused, or implemented against. Any HARD pattern, or enough SOFT log lines.
 *
 * @param content - md body to inspect / 検査するmd本文
 * @returns true when the file looks log-polluted / ログ混入で壊れていれば true
 */
export function looksLogPolluted(content: string | null | undefined): boolean {
  if (!content) return false;
  if (HARD_NOISE_PATTERNS.some((re) => re.test(content))) return true;
  const lines = content.split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return false;
  const noisy = nonEmpty.filter((l) => SOFT_NOISE_LINE.test(l)).length;
  // Many agent-log lines (absolute) or a large fraction → polluted.
  return noisy >= 6 || noisy / nonEmpty.length >= 0.2;
}

/** A polluted-file validation result (unusable; forces re-generation). */
function pollutedResult(label: string): ValidationResult {
  return {
    ok: false,
    missingSections: [],
    severity: 100,
    summary: `${label} is corrupted: agent execution log / stream output leaked into the file`,
  };
}

/**
 * Validate research.md content.
 */
export function validateResearch(content: string): ValidationResult {
  if (looksLogPolluted(content)) return pollutedResult('research.md');
  return validateSections(content, RESEARCH_REQUIRED_SECTIONS, 'research.md');
}

/**
 * Validate plan.md content. The "設計判断の根拠" section is the most
 * critical — without it, implementers will ask questions or guess.
 */
export function validatePlan(content: string): ValidationResult {
  if (looksLogPolluted(content)) return pollutedResult('plan.md');
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
  if (looksLogPolluted(content)) return pollutedResult('verify.md');
  const sectionResult = validateSections(content, VERIFY_REQUIRED_SECTIONS, 'verify.md');
  if (!sectionResult.ok) return sectionResult;

  const lower = content.toLowerCase();
  const claimsAllPass =
    /全[テt]?\d*\s*テスト[^❌]{0,30}通過|all\s+tests?\s+pass|all\s+\d+\s+tests?\s+passed|✅\s*検証成功|✅\s*pass/i.test(
      content,
    ) || /すべて(?:の)?テスト[^❌]{0,40}(成功|通過|パス)/.test(content);
  // Failure signals must indicate an ACTUAL non-zero failure. Earlier patterns
  // matched bare prose ("失敗テスト", "failing test") and the instructed
  // "失敗テスト数: 0" field, so any task that FIXES a failure (e.g. ENOENT/error
  // handling) — whose verify.md legitimately discusses failure scenarios and
  // reports "0 failed" — was wrongly flagged as a hallucinated pass and blocked.
  // Require a non-zero count (or an explicit fail mark) instead.
  const failureSignals = [
    /\b([1-9]\d*)\s+failed/i, // "10 failed" — not "0 failed"
    /tests?\s+([1-9]\d*)\s+failed/i,
    /test\s+files?[\s\S]{0,80}?([1-9]\d*)\s+failed/i,
    /失敗\s*(?:した)?テスト\s*(?:数|件数)?\s*[:：]?\s*([1-9]\d*)/, // "失敗テスト数: 3", not ": 0"
    /テスト[^。\n]{0,20}?([1-9]\d*)\s*(?:件|個)\s*(?:が)?\s*失敗/, // "テストが3件失敗"
    /exit\s*(?:code\s*)?[:=]?\s*1\b/i,
    /×\s*[1-9]\d*/, // "× 5" — not "× 0"
  ];
  const failureHits = failureSignals
    .map((re) => content.match(re))
    .filter((m): m is RegExpMatchArray => !!m);
  // A bare ❌ is too noisy to treat as a failure signal directly: a PASSING
  // verify.md routinely contains the PR-gate legend "全体判定が ❌ の場合のみ PR
  // を作成しないこと。本タスクは ✅ 合格。" (a CONDITIONAL), and the appended
  // self-repair feedback quotes the validator's own "(❌)" summary. Both made
  // every such passing report self-contradict and block. Only count a ❌ that
  // is an actual verdict — skip conditional/legend lines, parenthetical
  // references, and any line that simultaneously asserts a pass.
  const crossMarkFailure = content.split(/\r?\n/).some((line) => {
    if (!line.includes('❌')) return false;
    if (/❌\s*(?:の)?\s*(?:場合|とき|時|なら|ならば|であれば|if\b)/i.test(line)) return false;
    if (/[(（]\s*❌\s*[)）]/.test(line)) return false;
    if (/✅|合格|通過|成功|pass/i.test(line)) return false;
    return true;
  });
  if (crossMarkFailure) failureHits.push(['❌'] as unknown as RegExpMatchArray);

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
  // Accept the common verdicts the verifier actually writes, JP + EN. The ❌
  // anchor on the Japanese verdicts avoids false positives like "不合格項目: なし".
  if (/❌\s*(検証失敗|不合格|不適合)|❌\s*verification\s*fail|verify[: ]\s*fail/i.test(lower)) {
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
 * Whether an already-saved phase artifact is good enough to REUSE on a re-run
 * (so the phase skips regeneration). research/plan are reused unless their
 * validator flags a SERIOUS problem (severity ≥ 80 — e.g. an (almost) empty
 * file, or a plan missing its critical 設計判断の根拠 section). verify.md is
 * intentionally NOT handled here: a re-run must always re-verify the current
 * state and overwrite verify.md, so callers must never route 'verify' to this.
 *
 * @param outputFile - Phase output file type (research / plan / question). / フェーズ出力ファイル種別
 * @param content - Existing file content on disk. / ディスク上の既存内容
 * @returns true when the artifact may be reused as-is. / 再利用可能なら true
 */
export function isReusableArtifact(outputFile: string, content: string): boolean {
  if (!content.trim()) return false;
  if (outputFile === 'research') return validateResearch(content).severity < 80;
  if (outputFile === 'plan') return validatePlan(content).severity < 80;
  // question / other artifacts: reuse whenever present.
  return true;
}

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
function validateSections(
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
