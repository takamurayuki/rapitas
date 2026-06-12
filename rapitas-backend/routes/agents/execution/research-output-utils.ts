/**
 * execution/research-output-utils
 *
 * Pure utility functions for processing research-mode agent output.
 * Stateless — no DB access, no side effects. Exported so tests can import
 * directly instead of duplicating the logic.
 */

/**
 * True only for an isolated per-task git worktree (under `.worktrees/`), never
 * the main checkout. A destructive `git reset --hard` / `git clean -fd` must
 * NEVER run on the main repo — research/non-impl phases run in process.cwd()
 * (the main checkout), and reverting there wipes the user's (and the agent
 * platform's) UNCOMMITTED work. Guard every revert with this.
 *
 * @param dir - The execution directory to test / 実行ディレクトリ
 * @returns true when dir is an isolated worktree / 隔離worktreeなら true
 */
export function isIsolatedWorktree(dir: string): boolean {
  return dir.replace(/[\\/]+/g, '/').includes('/.worktrees/');
}

/**
 * Validate that a research report is substantive (not "調査専用モードとして進めます。"
 * style filler). Three hard rules:
 *   1. Must START with "# 調査レポート" (not just contain it somewhere)
 *   2. Must be ≥ 800 characters of substantive content
 *   3. Must contain at least 3 of the standard section headings
 *
 * @param content - Raw research markdown to validate / 検証対象のmarkdown
 * @returns Validation result with missing sections and reason / バリデーション結果
 */
export function validateResearchReport(content: string): {
  ok: boolean;
  missingSections: string[];
  reason: string;
} {
  const trimmed = (content || '').trim();
  if (trimmed.length === 0) {
    return { ok: false, missingSections: [], reason: 'empty output' };
  }
  // Rule 1: must START with `# 調査レポート` (English fallback also OK)
  if (!trimmed.startsWith('# 調査レポート') && !/^#\s+research report/i.test(trimmed)) {
    return {
      ok: false,
      missingSections: ['# 調査レポート'],
      reason: 'report does not START with the # 調査レポート heading (preamble detected)',
    };
  }
  // Rule 2: ≥ 800 chars of real content
  if (trimmed.length < 800) {
    return {
      ok: false,
      missingSections: [],
      reason: `output too short (${trimmed.length} chars; need >= 800)`,
    };
  }
  // Rule 3: at least 3 of the canonical sections present
  const sections = ['タスク概要', '既存機能', '影響範囲', '実装方針', 'リスク', 'テスト'];
  const lower = trimmed.toLowerCase();
  const missing = sections.filter((s) => !lower.includes(s.toLowerCase()));
  if (missing.length > 3) {
    return {
      ok: false,
      missingSections: missing,
      reason: `missing too many required sections (${missing.length} of ${sections.length})`,
    };
  }
  return { ok: true, missingSections: missing, reason: '' };
}

/**
 * Extract the final assistant message from codex `--json` stdout. Codex
 * emits one JSON object per line; the agent_message we want lives in
 * { type: "item.completed", item: { type: "agent_message", text: "..." } }.
 * Falls back to returning the raw text when no JSON events are detected
 * (i.e. the agent ran in non-JSON mode or output is already plain markdown).
 *
 * @param output - Raw stdout from the agent process / エージェントの生stdout
 * @returns Extracted markdown text / 抽出されたmarkdownテキスト
 */
export function extractFinalAgentMessage(output: string): string {
  if (!output) return '';
  const lines = output.split(/\r?\n/);
  const collected: string[] = [];
  let sawJson = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmedLine);
      sawJson = true;
      const item = (obj as { item?: { type?: string; text?: string } }).item;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        collected.push(item.text);
      }
    } catch {
      // not a JSON line — ignore
    }
  }
  if (collected.length > 0) return collected.join('\n\n').trim();
  // Fall back to the raw output (e.g. plain markdown without --json).
  return sawJson ? '' : output.trim();
}

/**
 * Slice the research markdown out of a possibly-noisy buffer. codex's
 * stdout often contains policy denials, command echoes, and other interim
 * logs BEFORE the final `# 調査レポート` heading. Taking lastIndexOf gives
 * us the report regardless of how much noise preceded it.
 *
 * @param raw - Combined stdout text (or already-extracted final message)
 * @returns Sliced markdown starting at `# 調査レポート`, or null when no
 *   heading is present.
 */
export function sliceResearchReport(raw: string): string | null {
  if (!raw) return null;
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  // Match the heading at the START of a line. We avoid `\b` because
  // JavaScript word boundaries don't recognize Japanese characters as word
  // chars, so `調査レポート\b` fails. Instead require end-of-line OR
  // whitespace after the heading text (line-start matching prevents the
  // mid-sentence false match `inline mention of # 調査レポート ...`).
  const headingMatcher = /^#\s+調査レポート\s*$/gm;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = headingMatcher.exec(normalized)) !== null) {
    lastIndex = match.index;
  }
  // English fallback for non-Japanese projects.
  if (lastIndex === -1) {
    const enMatcher = /^#\s+research report\s*$/gim;
    while ((match = enMatcher.exec(normalized)) !== null) {
      lastIndex = match.index;
    }
  }
  if (lastIndex === -1) return null;
  return normalized.slice(lastIndex).trim();
}
