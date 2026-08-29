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
 * @param defaultOptions - Localized yes/no fallback (caller supplies the
 *   translated pair; this pure module has no access to `useTranslations`). /
 *   ローカライズ済みのはい/いいえ既定値
 * @returns The options to render and whether they are synthesized / 表示する選択肢と既定かどうか
 */
export function resolveQuestionOptions(
  agentOptions: string[] | null | undefined,
  defaultOptions: readonly [string, string] = DEFAULT_QUESTION_OPTIONS,
): ResolvedQuestionOptions {
  const cleaned = (agentOptions ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
  if (cleaned.length > 0) return { options: cleaned, isDefault: false };
  return { options: [...defaultOptions], isDefault: true };
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

/** One selectable option within a {@link StructuredQuestion}. */
export interface StructuredQuestionOption {
  /** Short key the user's selection is recorded under (e.g. "A"). / 選択キー */
  key: string;
  /** Button label / 選択肢の表示文 */
  label: string;
  /** One-line consequence of choosing this option, folded into the composed answer. / 選択時の影響 */
  consequence: string;
  /**
   * True when choosing this option would change a gate's verification
   * threshold/condition. Excludes this option from the backend's stale-question
   * auto-answer heal pass even when recommended — see
   * rapitas-backend/services/workflow/question-options-parser.ts. Purely
   * informational on the frontend; a human may still pick it manually.
   * NOTE: keep in sync with rapitas-backend/services/workflow/question-options-parser.ts
   */
  mutatesGate?: boolean;
}

/** One machine-readable question parsed from a `json:options` block. */
export interface StructuredQuestion {
  /** Stable id used to correlate the answer (audit trail). / 質問ID */
  id: string;
  /** One-line summary shown as the question heading. / 一行要約 */
  summary: string;
  /** Selectable options (may be empty when freeTextRequired). / 選択肢 */
  options: StructuredQuestionOption[];
  /** True when a free-text answer is required (options alone can't express it). / 自由入力必須か */
  freeTextRequired: boolean;
  /** Why free text is required; non-null only when freeTextRequired. / 自由入力が必要な理由 */
  freeTextReason: string | null;
  /**
   * `key` of the option the question author recommends, or null when absent /
   * invalid (e.g. references no existing option). / 推奨する選択肢のkey
   */
  recommendedKey: string | null;
  /** 1-2 sentence rationale for `recommendedKey`; null when absent. / 推奨理由 */
  recommendedReason: string | null;
}

/** Parsed content of a `json:options` fenced block. */
export interface StructuredQuestionsBlock {
  questions: StructuredQuestion[];
}

const OPTIONS_BLOCK_RE = /```json:options\s*\n([\s\S]*?)```/;

/**
 * Parse the machine-readable `json:options` fenced block from a question.md
 * body. Returns `null` for ANY non-viable input (missing block, malformed
 * JSON, empty `questions`) so callers can fall back to the legacy
 * `parseIntakeQuestions`/`splitIntakeQuestion` chain without special-casing
 * exceptions — this never throws.
 *
 * @param md - The question.md body. / question.md 本文
 * @returns The parsed block, or `null` when absent/invalid. / パース結果、無効時は null
 */
export function parseOptionsBlock(md: string): StructuredQuestionsBlock | null {
  try {
    const match = (md ?? '').match(OPTIONS_BLOCK_RE);
    if (!match) return null;
    const parsed: unknown = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== 'object') return null;
    const questionsRaw = (parsed as { questions?: unknown }).questions;
    if (!Array.isArray(questionsRaw) || questionsRaw.length === 0) return null;

    const questions: StructuredQuestion[] = [];
    for (const raw of questionsRaw) {
      if (!raw || typeof raw !== 'object') return null;
      const q = raw as Record<string, unknown>;
      const id = q.id;
      const summary = q.summary;
      if (typeof id !== 'string' || !id.trim() || typeof summary !== 'string' || !summary.trim()) {
        return null;
      }
      const options: StructuredQuestionOption[] = [];
      if (Array.isArray(q.options)) {
        for (const rawOption of q.options) {
          if (!rawOption || typeof rawOption !== 'object') continue;
          const o = rawOption as Record<string, unknown>;
          if (typeof o.key !== 'string' || !o.key.trim() || typeof o.label !== 'string') continue;
          options.push({
            key: o.key,
            label: o.label,
            consequence: typeof o.consequence === 'string' ? o.consequence : '',
            mutatesGate: o.mutatesGate === true,
          });
        }
      }
      const freeTextRequired = q.freeTextRequired === true;
      const freeTextReason = typeof q.freeTextReason === 'string' ? q.freeTextReason : null;
      // Neither answerable path is available — this question can't be rendered.
      if (!freeTextRequired && options.length === 0) return null;
      // Defensive parse (same policy as freeTextReason above): an absent or
      // malformed `recommended`/`recommendedReason`, or a `recommended` key
      // that names no existing option, silently degrades to "no
      // recommendation" instead of rejecting the whole question — question.md
      // files saved before this field existed must keep rendering.
      const recommendedKeyRaw = typeof q.recommended === 'string' ? q.recommended : null;
      const recommendedKey =
        recommendedKeyRaw && options.some((o) => o.key === recommendedKeyRaw)
          ? recommendedKeyRaw
          : null;
      const recommendedReason =
        recommendedKey && typeof q.recommendedReason === 'string' ? q.recommendedReason : null;
      questions.push({
        id,
        summary,
        options,
        freeTextRequired,
        freeTextReason,
        recommendedKey,
        recommendedReason,
      });
    }
    return { questions };
  } catch {
    return null;
  }
}

/**
 * Remove the `json:options` fenced block from a question.md body, leaving
 * only the human-readable Markdown prose for display.
 *
 * @param md - The question.md body. / question.md 本文
 * @returns The body with the block stripped and trimmed. / ブロック除去後の本文
 */
export function stripOptionsBlock(md: string): string {
  return (md ?? '').replace(OPTIONS_BLOCK_RE, '').trim();
}

/** One user answer to a {@link StructuredQuestion}, aligned by array index. */
export interface StructuredAnswerEntry {
  /** Selected option key, or null when answered via free text. / 選択キー */
  key: string | null;
  /** Free-text content; used when key is null. / 自由記述内容 */
  freeText: string;
}

/** Audit record of which option (if any) the user picked per question. */
export interface StructuredSelection {
  questionId: string;
  selectedKey: string | null;
}

/**
 * Compose the final answer text sent to the existing `{answer}` API by
 * folding each question's selected option (label + consequence) or free-text
 * entry under a `## <id>: <summary>` heading, plus the `selections` audit
 * payload keyed by question id.
 *
 * @param questions - Parsed structured questions. / 構造化質問群
 * @param answers - User answers, index-aligned with `questions`. / 質問と同順の回答
 * @returns The composed answer text and the selections audit list. / 合成回答と選択監査
 */
export function composeStructuredAnswer(
  questions: StructuredQuestion[],
  answers: StructuredAnswerEntry[],
): { answerText: string; selections: StructuredSelection[] } {
  const parts: string[] = [];
  const selections: StructuredSelection[] = [];
  questions.forEach((q, i) => {
    const a = answers[i];
    let body = '';
    if (a?.key) {
      const opt = q.options.find((o) => o.key === a.key);
      if (opt) {
        body = opt.consequence
          ? `選択: ${opt.label}（影響: ${opt.consequence}）`
          : `選択: ${opt.label}`;
      }
    }
    if (!body && a?.freeText?.trim()) {
      body = `自由入力: ${a.freeText.trim()}`;
    }
    parts.push(`## ${q.id}: ${q.summary}\n${body}`);
    selections.push({ questionId: q.id, selectedKey: a?.key ?? null });
  });
  return { answerText: parts.join('\n\n'), selections };
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
