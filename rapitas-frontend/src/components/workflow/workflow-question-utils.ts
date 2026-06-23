/**
 * workflow-question-utils
 *
 * Pure helpers for the workflow Q&A panel. No React / side effects.
 */

/** Default quick-choice options when the agent asked a free-text question. */
export const DEFAULT_QUESTION_OPTIONS = ['はい', 'いいえ'] as const;

export interface ResolvedQuestionOptions {
  /** Options to render as selectable buttons. */
  options: string[];
  /** True when these are the synthesized defaults (no agent-provided options). */
  isDefault: boolean;
}

/**
 * Resolve the choices to display. Per policy, questions are answered by
 * multiple-choice by DEFAULT: when the agent supplied options we use them; when
 * it asked free-text we synthesize quick yes/no defaults. Free-text entry stays
 * available either way (for "specific user-directed content"), so a default
 * never traps the user.
 *
 * @param agentOptions - Options parsed from the agent's question / エージェント提示の選択肢
 * @returns The options to render and whether they are synthesized / 表示する選択肢と既定かどうか
 */
export function resolveQuestionOptions(
  agentOptions: string[] | null | undefined,
): ResolvedQuestionOptions {
  const cleaned = (agentOptions ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  if (cleaned.length > 0) return { options: cleaned, isDefault: false };
  return { options: [...DEFAULT_QUESTION_OPTIONS], isDefault: true };
}

/** One parsed intake question (1問1答). */
export interface ParsedIntakeQuestion {
  /** Heading label (e.g. "質問1: 達成すべきゴール"). / 見出し */
  label: string;
  /** The question prose. / 質問文 */
  text: string;
  /** Selectable options (may be empty → free-text). / 選択肢 */
  options: string[];
}

/**
 * Parse an intake `question.md` into its intro prose + the list of `## 質問N`
 * questions (each with its `### 選択肢`). The UI shows them ONE AT A TIME (1問1答)
 * and badges the Q&A tab with `questions.length`. Returns an empty list when the
 * file has no `## 質問` blocks (e.g. a legacy single-question file), so the caller
 * can fall back to {@link splitIntakeQuestion}.
 *
 * @param md - The question.md body. / question.md 本文
 * @returns The intro text and the parsed questions. / イントロと質問配列
 */
export function parseIntakeQuestions(md: string): {
  intro: string;
  questions: ParsedIntakeQuestion[];
} {
  const lines = (md ?? '').split(/\r?\n/);
  const intro: string[] = [];
  const questions: ParsedIntakeQuestion[] = [];
  let cur: ParsedIntakeQuestion | null = null;
  let inOptions = false;
  let seenFirstQuestion = false;
  for (const raw of lines) {
    const line = raw.trim();
    const qMatch = line.match(/^##\s*(質問\s*\d+.*)$/);
    if (qMatch) {
      if (cur) questions.push(cur);
      cur = { label: qMatch[1].trim(), text: '', options: [] };
      inOptions = false;
      seenFirstQuestion = true;
      continue;
    }
    if (!cur) {
      // Before the first 質問 block: collect intro, but stop at 回答方法 etc.
      if (!seenFirstQuestion && !/^##\s/.test(line)) intro.push(raw);
      continue;
    }
    if (/^###\s*選択肢/.test(line)) {
      inOptions = true;
      continue;
    }
    if (/^##\s/.test(line)) {
      // A non-質問 heading (e.g. 回答方法) ends the current question + the list.
      questions.push(cur);
      cur = null;
      break;
    }
    if (inOptions) {
      const m = line.match(/^[-*]\s+(.+)$/);
      if (m) cur.options.push(m[1].trim());
      continue;
    }
    if (line) cur.text = cur.text ? `${cur.text}\n${line}` : line;
  }
  if (cur) questions.push(cur);
  return { intro: intro.join('\n').trim(), questions };
}

/**
 * Split an intake `question.md` into its prose and selectable options. The backend
 * embeds choices under a `## 選択肢` bullet block (see intake-question-template);
 * the UI renders those as buttons, so they are STRIPPED from the displayed prose to
 * avoid showing the same options twice (once as text, once as buttons).
 *
 * @param md - The question.md body. / question.md 本文
 * @returns The prose (options section removed) and the parsed option strings.
 */
export function splitIntakeQuestion(md: string): { text: string; options: string[] } {
  const lines = (md ?? '').split(/\r?\n/);
  const options: string[] = [];
  const kept: string[] = [];
  let inOptions = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s*選択肢/.test(line)) {
      inOptions = true;
      continue; // drop the heading from the prose
    }
    if (inOptions) {
      if (/^#{1,6}\s/.test(line)) {
        inOptions = false; // next heading ends the options block
      } else {
        const m = line.match(/^[-*]\s+(.+)$/);
        if (m) options.push(m[1].trim());
        continue; // drop option bullets (and blanks) from the prose
      }
    }
    kept.push(raw);
  }
  return { text: kept.join('\n').trim(), options };
}

/**
 * Seconds remaining until an ISO deadline, or null when no deadline.
 *
 * @param deadlineIso - ISO timestamp the question auto-continues at / 自動継続の期限
 * @param nowMs - Current epoch ms (injectable for tests) / 現在時刻
 * @returns Whole seconds remaining (>= 0), or null / 残り秒数
 */
export function secondsUntil(deadlineIso: string | null | undefined, nowMs: number): number | null {
  if (!deadlineIso) return null;
  const deadline = Date.parse(deadlineIso);
  if (Number.isNaN(deadline)) return null;
  return Math.max(0, Math.round((deadline - nowMs) / 1000));
}
