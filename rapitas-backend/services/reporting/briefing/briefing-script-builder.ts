/**
 * briefing-script-builder
 *
 * Builds the 5-part briefing script (summary → completed → held → decision →
 * link) from structured data and enforces the 180-second budget. Numbers,
 * ids and titles always come from the structured input; an optional LLM
 * narrative may only reference them through {{key}} placeholders.
 */
import { clip, BRIEFING_MAX_CHARS } from './briefing-duration';
import { pickDecision } from './briefing-decision-picker';
import type {
  BriefingInput,
  BriefingScript,
  BriefingSection,
  DecisionCandidate,
} from './briefing-types';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
const TITLE_MAX = 24;
const REASON_MAX = 20;
const OPTION_MAX = 16;
const OPTION_COUNT = 3;

/**
 * Substitute {{key}} placeholders. Returns null when any key is unknown so
 * the caller can discard an LLM text that invents facts.
 *
 * @param template - Template text / テンプレート
 * @param values - Allowed key → value map / 差し込み値
 * @returns Filled text or null / 置換後の文字列、未知キーがあれば null
 */
export function fillPlaceholders(template: string, values: Record<string, string>): string | null {
  let unknown = false;
  const out = template.replace(PLACEHOLDER_RE, (_m, key: string) => {
    if (!(key in values)) {
      unknown = true;
      return '';
    }
    return values[key];
  });
  return unknown ? null : out;
}

/** Options for {@link buildBriefingScript}. */
export interface BuildScriptOptions {
  /** Optional LLM-written overview using {{completed}} / {{held}} / {{decision}} / {{date}}. */
  narrative?: string;
  /** Character budget override (default 900); used to shrink after a real-length overrun. */
  maxChars?: number;
}

function sectionsFor(
  input: BriefingInput,
  decision: DecisionCandidate | null,
  showC: number,
  showH: number,
  optionCount: number,
  narrative: string | undefined,
): BriefingSection[] {
  const values = {
    date: input.date,
    completed: String(input.completed.length),
    held: String(input.held.length),
    decision: decision ? '1' : '0',
  };
  const defaultSummary = `${input.date} の夜間実行結果です。完了${values.completed}件、保留・停止${values.held}件、要判断${values.decision}件。`;
  const summary = (narrative ? fillPlaceholders(narrative, values) : null) ?? defaultSummary;

  const completedLines = input.completed
    .slice(0, showC)
    .map(
      (c) =>
        `#${c.id} ${clip(c.title, TITLE_MAX)}${c.prNumber != null ? ` (PR ${c.prNumber})` : ''}`,
    );
  const hiddenC = input.completed.length - showC;
  if (hiddenC > 0) completedLines.push(`他${hiddenC}件`);
  if (input.completed.length === 0) completedLines.push('完了したタスクはありません。');

  const heldLines = input.held
    .slice(0, showH)
    .map((h) => `#${h.id} ${clip(h.title, TITLE_MAX)}: ${clip(h.reason, REASON_MAX)}`);
  const hiddenH = input.held.length - showH;
  if (hiddenH > 0) heldLines.push(`他${hiddenH}件`);
  if (input.held.length === 0) heldLines.push('保留・停止中のタスクはありません。');

  const decisionLines = decision
    ? [
        `判断が必要です。#${decision.id} ${clip(decision.title, TITLE_MAX)}。`,
        ...decision.options
          .slice(0, optionCount)
          .map((o, i) => `選択肢${i + 1}: ${clip(o, OPTION_MAX)}`),
      ]
    : ['判断事項はありません。'];

  return [
    { id: 'summary', lines: [summary] },
    { id: 'completed', lines: completedLines },
    { id: 'held', lines: heldLines },
    { id: 'decision', lines: decisionLines },
    { id: 'link', lines: [`全文は ${input.linkUrl} で確認できます。`] },
  ];
}

/**
 * Render a script as the single spoken text.
 *
 * @param script - Built script / 台本
 * @returns Newline-joined text / 読み上げ本文
 */
export function renderScriptText(script: BriefingScript): string {
  return script.sections.flatMap((s) => s.lines).join('\n');
}

/**
 * Build the briefing script and shrink it until it fits the 180 s budget.
 * Shrink order: trailing completed items, then held items (folded into
 * 「他N件」), then decision options. Summary, decision and link always stay.
 *
 * @param input - Structured briefing input / 構造化入力
 * @param options - Optional LLM narrative / 任意の要約文
 * @returns The ordered script / 台本
 */
export function buildBriefingScript(
  input: BriefingInput,
  options: BuildScriptOptions = {},
): BriefingScript {
  const decision = pickDecision(input.decisionCandidates);
  let showC = input.completed.length;
  let showH = input.held.length;
  let optionCount = OPTION_COUNT;

  const build = (): BriefingSection[] =>
    sectionsFor(input, decision, showC, showH, optionCount, options.narrative);
  const length = (s: BriefingSection[]) => [...s.flatMap((x) => x.lines).join('\n')].length;

  let sections = build();
  while (length(sections) > (options.maxChars ?? BRIEFING_MAX_CHARS)) {
    if (showC > 0) showC--;
    else if (showH > 0) showH--;
    else if (optionCount > 0) optionCount--;
    else break;
    sections = build();
  }

  return {
    date: input.date,
    sections,
    decision,
    counts: {
      completed: input.completed.length,
      held: input.held.length,
      decision: decision ? 1 : 0,
    },
  };
}
