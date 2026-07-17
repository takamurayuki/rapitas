/**
 * log-display-utils
 *
 * Pure render-prep helpers for the execution log display: raw-markdown dump
 * detection/collapsing, markdown decoration stripping, narrative-prose
 * detection, and consecutive-duplicate grouping (×N counters).
 * No React, no i18n, no side effects — safe to call in useMemo/render and
 * to unit-test in isolation.
 */

import type { UserFriendlyLogEntry } from './log-pattern-rules';

/** A run of raw markdown lines collapsed into a single expandable token. */
export interface MarkdownBlockToken {
  kind: 'markdown-block';
  /** The raw markdown content, newline-joined. / 生のMarkdown本文 */
  content: string;
  /** Character count of `content` (for the summary line). / 文字数 */
  charCount: number;
  /** Workflow file the dump came from, when detectable. / 判別できた場合のファイル名 */
  fileName?: string;
}

/** A raw log line, or a collapsed markdown dump. */
export type LineOrMarkdownBlock = string | MarkdownBlockToken;

const MD_HEADING = /^#{1,6}\s+\S/;
const MD_FENCE = /^```/;
const MD_MARKERS = [
  MD_HEADING,
  MD_FENCE,
  /^\s*[-*+]\s+\S/, // bullet list
  /^\s*\d+\.\s+\S/, // numbered list
  /^>\s/, // blockquote
  /^\|.+\|\s*$/, // table row
  /^\*\*[^*]+\*\*/, // bold-opening line
];

// Lines the backend tags ([Tool: ...], [System: ...], file_edit, shell "$ ")
// terminate a markdown run — they are classified log events, not md content.
const LOG_TAG_BOUNDARY = /^\[|^file_(edit|create)\s|^\$\s/;

// Workflow artifact files whose contents commonly get echoed into the log.
const WORKFLOW_FILE = /(research|plan|verify|question|instruction)\.md\b/;

// Kana implies a Japanese sentence (paths/identifiers are kana-free).
const JA_KANA = /[ぁ-んァ-ヶー]/;
const NARRATIVE_OPENERS =
  /^(I will|I'll|I've|I am|I'm|Let me|Let's|Now I|First,?\s|Then I|Next,?\s|Looking at|Based on)/i;
const SENTENCE_END = /[.!?。！？…]["')\]]?\s*$/;

/**
 * Whether a line carries a markdown structural marker (heading, bullet,
 * fence, table row, blockquote, bold opener).
 *
 * @param line - Raw log line. / 生ログ行
 * @returns `true` when the line looks like markdown structure. / Markdown構造に見える場合 `true`
 */
export function isMarkdownMarkerLine(line: string): boolean {
  return MD_MARKERS.some((p) => p.test(line));
}

/**
 * Strip markdown decorations (heading hashes, bullet markers, bold/italic
 * markers, inline backticks) from a single-line message so the log list shows
 * clean prose. Content inside the decorations is preserved.
 *
 * @param text - Single-line message. / 1行のメッセージ
 * @returns The text without markdown decorations. / 装飾を除いたテキスト
 */
export function stripMarkdownDecorations(text: string): string {
  return text
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** Find a workflow artifact file name in nearby context lines, if any. */
function detectWorkflowFileName(contextLines: (string | undefined)[]): string | undefined {
  for (const line of contextLines) {
    if (!line) continue;
    const m = line.match(WORKFLOW_FILE);
    if (m) return `${m[1]}.md`;
  }
  return undefined;
}

/**
 * Collapse runs of raw markdown-file content (echoed research.md/plan.md/...
 * dumps) into single {@link MarkdownBlockToken}s so the viewer can render one
 * expandable summary entry instead of streaming the raw file.
 *
 * A run starts at a heading/fence (or two consecutive marker lines) and
 * absorbs following non-tagged lines; it qualifies as a block when it spans
 * ≥3 lines with ≥2 markdown markers.
 *
 * @param lines - Split raw log lines. / 分割済みの生ログ行
 * @returns Lines with markdown runs replaced by block tokens. / Markdown連続行をトークン化した配列
 */
export function collapseMarkdownBlocks(lines: string[]): LineOrMarkdownBlock[] {
  const out: LineOrMarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const startsRun =
      MD_HEADING.test(line) ||
      MD_FENCE.test(line) ||
      (isMarkdownMarkerLine(line) && i + 1 < lines.length && isMarkdownMarkerLine(lines[i + 1]));

    if (startsRun) {
      const block: string[] = [];
      let markers = 0;
      let j = i;
      while (j < lines.length && !LOG_TAG_BOUNDARY.test(lines[j])) {
        block.push(lines[j]);
        if (isMarkdownMarkerLine(lines[j])) markers++;
        j++;
      }
      if (block.length >= 3 && markers >= 2) {
        const content = block.join('\n');
        out.push({
          kind: 'markdown-block',
          content,
          charCount: content.length,
          fileName: detectWorkflowFileName([lines[i - 2], lines[i - 1], ...block.slice(0, 3)]),
        });
        i = j;
        continue;
      }
    }

    out.push(line);
    i++;
  }

  return out;
}

/**
 * Whether an unclassified line reads as agent narrative prose (the reasoning
 * a human wants to follow) rather than mechanical output.
 *
 * Heuristics: any kana implies a Japanese sentence; English needs a typical
 * narrative opener, or sentence-ending punctuation with ≥4 words.
 *
 * @param line - Raw log line that matched no pattern rule. / どのルールにも一致しなかった行
 * @returns `true` for narrative prose. / エージェントの思考文なら `true`
 */
export function isNarrativeProse(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || LOG_TAG_BOUNDARY.test(trimmed)) return false;
  if (JA_KANA.test(trimmed)) return true;
  if (NARRATIVE_OPENERS.test(trimmed)) return true;
  return SENTENCE_END.test(trimmed) && trimmed.split(/\s+/).length >= 4;
}

/**
 * Extract a one-line human summary from a dispatched instruction/prompt:
 * the first meaningful line with markdown decorations stripped, cut at the
 * first sentence end, capped at 120 chars.
 *
 * @param text - Raw instruction text (may be multi-line markdown). / 指示の原文
 * @returns One-line summary. / 1行サマリ
 */
export function summarizeInstruction(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((l) => stripMarkdownDecorations(l))
      .find((l) => l.length > 0) ?? '';
  // A '.' only ends a sentence before whitespace/EOL so `config.ts` survives.
  const end = firstLine.search(/[。！？]|[.!?](?=\s|$)/);
  const sentence = end >= 0 ? firstLine.slice(0, end + 1) : firstLine;
  return sentence.length > 120 ? `${sentence.slice(0, 120)}...` : sentence;
}

/**
 * Merge entries with identical rendered content into one entry carrying a
 * `count` (rendered as a ×N badge). Targets repeated markers such as
 * `[System: thinking_tokens]` spam and same-event lines emitted by two log
 * sources. Pure: inputs are not mutated.
 *
 * @param entries - Classified entries in stream order. / 分類済みエントリ配列
 * @param lookback - How many previous rendered entries to search for a
 *   duplicate (1 = adjacent only). Near-window merging catches duplicates
 *   emitted by distinct sources a few entries apart. / 重複を探す遡り件数
 * @returns Entries with nearby duplicates merged. / 近傍重複をまとめた配列
 */
export function dedupeConsecutiveEntries(
  entries: UserFriendlyLogEntry[],
  lookback: number = 1,
): UserFriendlyLogEntry[] {
  const out: UserFriendlyLogEntry[] = [];
  for (const entry of entries) {
    let merged = false;
    for (let k = out.length - 1; k >= Math.max(0, out.length - lookback); k--) {
      const prev = out[k];
      if (
        prev.category === entry.category &&
        prev.message === entry.message &&
        prev.detail === entry.detail
      ) {
        // Copy-on-merge keeps the input entries immutable.
        out[k] = { ...prev, count: (prev.count ?? 1) + (entry.count ?? 1) };
        merged = true;
        break;
      }
    }
    if (!merged) out.push(entry);
  }
  return out;
}
