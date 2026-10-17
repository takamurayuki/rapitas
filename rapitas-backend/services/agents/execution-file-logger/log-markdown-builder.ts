/**
 * ExecutionFileLogger / Markdown builder
 *
 * Pure functions that render structured log entries as a Markdown outline
 * (h2 = phase, h3 = step) and validate heading-level continuity.
 * Not responsible for file I/O or for the legacy plain-text log layout.
 */

import type { ExecutionSummary, StructuredLogEntry } from './types';

/** Event types that mark a meaningful step boundary (everything else is detail). */
const STEP_EVENT_TYPES = new Set<string>([
  'execution_start',
  'execution_end',
  'status_change',
  'git_commit',
  'question_detected',
  'error',
  'timeout',
]);

const SUCCESS_LABEL = '（成功）';
const FAILURE_LABEL = '（失敗）';
const DEFAULT_PHASE = 'execution';

function isFailure(entry: StructuredLogEntry): boolean {
  return (
    entry.level === 'ERROR' ||
    entry.level === 'FATAL' ||
    entry.eventType === 'error' ||
    entry.eventType === 'timeout'
  );
}

/**
 * Collapses text to one line and neutralises everything that could alter the outline:
 * comment delimiters, code-fence runs, leading heading markers, and forged status labels.
 */
function toHeadingText(text: string): string {
  let out = text
    // `--!>` is also a comment terminator; matching only `-->` left it intact.
    .replace(/<!--|--!?>/g, ' ') // a stray comment delimiter could swallow or inject Markdown
    .replace(/`{3,}|~{3,}/g, ' ') // fence runs would hide later headings from validators/renderers
    .replace(/（成功）|（失敗）/g, ' ') // a forged status suffix must not satisfy the status check
    .replace(/\s+/g, ' ')
    .trim();
  // Loop: a single pass leaves '# # x' as '# x', which still renders as a heading.
  while (/^#+(\s|$)/.test(out)) out = out.replace(/^#+\s*/, '');
  return out;
}

/** The entry's own stable sequence id, if any (never an array index). */
function seqOf(entry: StructuredLogEntry): number | undefined {
  const seq = entry.context?.sequenceNumber;
  return typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined;
}

/** Raw-log reference: executionId + timestamp always, plus the entry's own sequenceNumber when present. */
function refOf(entry: StructuredLogEntry): string {
  const seq = seqOf(entry);
  const seqPart = seq === undefined ? '' : ` seq ${seq}`;
  return `- ref: execution ${entry.executionId}${seqPart} @ ${entry.timestamp}`;
}

/** Range reference for a phase: first..last own sequence ids (when present) and timestamps. */
function rangeRefOf(first: StructuredLogEntry, last: StructuredLogEntry): string {
  const a = seqOf(first);
  const b = seqOf(last);
  const seqPart = a !== undefined && b !== undefined ? ` seq ${a}-${b}` : '';
  return `- ref: execution ${first.executionId}${seqPart} @ ${first.timestamp} .. ${last.timestamp}`;
}

function phaseOf(entry: StructuredLogEntry): string {
  const phase = entry.context?.phase;
  return typeof phase === 'string' && phase.trim() ? toHeadingText(phase) : DEFAULT_PHASE;
}

/**
 * Builds a Markdown outline of an execution log.
 *
 * @param entries - Structured entries in chronological order / 時系列順のログエントリ
 * @param summary - Optional execution summary used for the document marker / 実行サマリ
 * @returns Markdown whose headings start at h2 and end with （成功）or（失敗） / Markdown 文字列
 */
export function buildMarkdownLog(
  entries: StructuredLogEntry[],
  summary?: Pick<ExecutionSummary, 'executionId' | 'taskTitle'>,
): string {
  const lines: string[] = [];
  if (summary) {
    lines.push(`<!-- execution:${summary.executionId} ${toHeadingText(summary.taskTitle)} -->`, '');
  }

  // Group consecutive entries by phase.
  const groups: { phase: string; items: { entry: StructuredLogEntry }[] }[] = [];
  entries.forEach((entry) => {
    const phase = phaseOf(entry);
    const last = groups[groups.length - 1];
    if (last && last.phase === phase) last.items.push({ entry });
    else groups.push({ phase, items: [{ entry }] });
  });

  for (const group of groups) {
    const first = group.items[0];
    const lastItem = group.items[group.items.length - 1];
    const failed = group.items.some((it) => isFailure(it.entry));
    lines.push(
      `## ${group.phase} ${first.entry.timestamp}〜${lastItem.entry.timestamp}${failed ? FAILURE_LABEL : SUCCESS_LABEL}`,
      '',
      rangeRefOf(first.entry, lastItem.entry),
      '',
    );
    for (const { entry } of group.items) {
      // A failing entry is always a step, so a （失敗） phase heading never lacks its cause.
      if (!STEP_EVENT_TYPES.has(entry.eventType) && !isFailure(entry)) continue;
      lines.push(
        `### ${entry.eventType} ${entry.timestamp}${isFailure(entry) ? FAILURE_LABEL : SUCCESS_LABEL}`,
        '',
        refOf(entry),
        `- message: ${toHeadingText(entry.message)}`,
        '',
      );
    }
  }
  return lines.join('\n');
}

/**
 * Validates heading continuity: first heading is h2, no heading is more than
 * one level deeper than its predecessor, and every heading ends with a status.
 *
 * @param markdown - Markdown to inspect / 検査対象
 * @returns Violations (empty when valid) / 違反一覧
 */
export function validateHeadingContinuity(markdown: string): string[] {
  const errors: string[] = [];
  let prev = 1; // so the first heading must be h2
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    if (level > prev + 1) errors.push(`h${level} follows h${prev}: ${m[2]}`);
    if (!m[2].endsWith(SUCCESS_LABEL) && !m[2].endsWith(FAILURE_LABEL)) {
      errors.push(`missing status suffix: ${m[2]}`);
    }
    prev = level;
  }
  return errors;
}
