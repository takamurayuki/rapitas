/**
 * Task Spec Deriver
 *
 * Derives a structured task spec (goals / constraints / acceptance criteria) from a
 * free-text task description using the configured AI provider.
 * Does NOT persist anything — callers decide how to use the derived spec.
 */
import { createLogger } from '../../config/logger';
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../../utils/ai-client';
import { ClaudeCliUnavailableError } from '../../utils/ai-client/claude-cli-provider';

const logger = createLogger('task-spec-deriver');

/** Structured spec derived from a free-text description. */
export interface DerivedTaskSpec {
  goals: string[];
  constraints: string[];
  acceptanceCriteria: string[];
}

const SYSTEM_PROMPT = `あなたはソフトウェア開発タスクの仕様を整理するアシスタントです。
ユーザーが書いた自由記述のタスク説明から、次の3つを日本語で抽出してください。
- goals: このタスクで達成すべきゴール（What）
- constraints: 守るべき制約・前提（スコープ外、技術制約、後方互換性など）
- acceptanceCriteria: 完了を判定できる、検証可能な受入基準

出力は必ず次のJSONのみ。前後に説明文やコードブロックを付けないこと:
{"goals":["..."],"constraints":["..."],"acceptanceCriteria":["..."]}

各配列は0〜6項目。該当が無ければ空配列にする。説明文から妥当に導けるものに限定し、過度な推測はしない。`;

const EMPTY: DerivedTaskSpec = { goals: [], constraints: [], acceptanceCriteria: [] };

/** Extracts a clean string[] from an unknown JSON value. */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, 6);
}

/** Parses the AI response (expected JSON object) into a DerivedTaskSpec. */
function parseSpec(content: string): DerivedTaskSpec {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return { ...EMPTY };
  try {
    const parsed = JSON.parse(match[0]);
    return {
      goals: toStringArray(parsed.goals),
      constraints: toStringArray(parsed.constraints),
      acceptanceCriteria: toStringArray(parsed.acceptanceCriteria),
    };
  } catch {
    return { ...EMPTY };
  }
}

const OPTIONS_SYSTEM_PROMPT = `あなたはソフトウェア開発タスクの「ゴール候補」を提示するアシスタントです。
与えられたタスクのタイトルと説明から、ユーザーが選びやすい、互いに異なる「達成ゴールの方向性」を2〜4個、日本語の短い選択肢として提案してください。
- 各選択肢は1行・15〜40文字程度の簡潔な文。
- 抽象的すぎる選択肢（「品質を上げる」等）は避け、このタスク固有の具体的な方向性にする。
- 互いに重複しない、明確に異なる方向性にする。
出力は必ず次のJSONのみ。前後に説明文やコードブロックを付けないこと:
{"options":["...","..."]}`;

/** One clarifying question with its selectable options. */
export interface IntakeQuestion {
  /** Which spec field it clarifies (goals/constraints/acceptanceCriteria). */
  field: string;
  /** The single, focused question (1問1答). */
  question: string;
  /** 2-4 selectable answers. / 選択肢 */
  options: string[];
}

const QUESTIONS_SYSTEM_PROMPT = `あなたはソフトウェア開発タスクの仕様を、ユーザーへの「1問1答」で固めるアシスタントです。
不足している仕様項目それぞれについて、ユーザーが選んで答えられる「1問」を作ってください。
ルール:
- 不足項目1つにつき質問1つ。長い複合質問にしない（粒度を細かく、1問1答）。
- 各質問に2〜4個の具体的で互いに異なる選択肢を付ける。選択肢は1行・15〜40文字。
- 抽象的すぎる選択肢は避け、このタスク固有にする。
- field は "goals" | "constraints" | "acceptanceCriteria" のいずれか。
出力は必ず次のJSONのみ。前後に説明文やコードブロックを付けないこと:
{"questions":[{"field":"goals","question":"...","options":["...","..."]}]}`;

/**
 * Generate ONE focused clarifying question per missing spec field (1問1答), each
 * with selectable options — so the UI can present them one at a time with clear
 * question↔answer correspondence rather than one long fill-in prompt. Returns []
 * when AI is unavailable or fails (caller falls back to a single heuristic question).
 *
 * @param title - Task title. / タスクタイトル
 * @param description - Free-text description. / タスク説明
 * @param missingFields - Spec fields detected as missing. / 不足項目
 * @returns One question per field, or [] on failure. / 質問配列
 */
export async function generateIntakeQuestions(
  title: string,
  description: string,
  missingFields: string[],
): Promise<IntakeQuestion[]> {
  if (missingFields.length === 0 || !(await isAnyApiKeyConfigured())) return [];
  const basis = `# タスクタイトル\n${title}\n\n# 説明\n${(description ?? '').trim() || '(説明なし)'}\n\n# 不足している仕様項目\n${missingFields.join(', ')}`;
  try {
    const provider = await getDefaultProvider();
    const response = await sendAIMessage({
      provider,
      messages: [{ role: 'user', content: basis }],
      systemPrompt: QUESTIONS_SYSTEM_PROMPT,
      maxTokens: 900,
    });
    const match = response.content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .map((q): IntakeQuestion | null => {
        const obj = q as { field?: unknown; question?: unknown; options?: unknown };
        const question = typeof obj.question === 'string' ? obj.question.trim() : '';
        const options = toStringArray(obj.options).slice(0, 4);
        if (!question) return null;
        return { field: typeof obj.field === 'string' ? obj.field : 'goals', question, options };
      })
      .filter((q): q is IntakeQuestion => q !== null)
      .slice(0, 4);
  } catch (error) {
    logger.warn({ err: error }, '[task-spec-deriver] intake question generation failed');
    return [];
  }
}

/**
 * Ask the AI to propose 2-4 distinct, task-specific GOAL options the user can pick
 * from when a task's spec is too thin (the intake clarifying question). This is the
 * "executing agent generates the choices" path — richer than a fixed task-type
 * heuristic. Returns [] when AI is unavailable or fails, so the caller can fall
 * back to the heuristic options.
 *
 * @param title - Task title. / タスクタイトル
 * @param description - Free-text description (may be empty). / タスク説明
 * @returns 2-4 option strings, or [] on failure. / 選択肢、失敗時は空配列
 */
export async function generateIntakeGoalOptions(
  title: string,
  description: string,
): Promise<string[]> {
  if (!(await isAnyApiKeyConfigured())) return [];
  const basis = `# タスクタイトル\n${title}\n\n# 説明\n${(description ?? '').trim() || '(説明なし)'}`;
  try {
    const provider = await getDefaultProvider();
    const response = await sendAIMessage({
      provider,
      messages: [{ role: 'user', content: basis }],
      systemPrompt: OPTIONS_SYSTEM_PROMPT,
      maxTokens: 512,
    });
    const match = response.content.match(/\{[\s\S]*\}/);
    if (!match) return [];
    return toStringArray((JSON.parse(match[0]) as { options?: unknown }).options).slice(0, 4);
  } catch (error) {
    logger.warn({ err: error }, '[task-spec-deriver] intake option generation failed');
    return [];
  }
}

/**
 * Derive structured goals/constraints/acceptance criteria from a free-text description.
 *
 * @param description - Free-text task description / 自由記述のタスク説明
 * @returns Derived spec plus a source indicator / 抽出結果とソース種別
 */
export async function deriveTaskSpec(
  description: string,
): Promise<{ spec: DerivedTaskSpec; source: 'ai' | 'empty' | 'no_ai' | 'ai_error' }> {
  if (!description.trim()) return { spec: { ...EMPTY }, source: 'empty' };

  if (!(await isAnyApiKeyConfigured())) {
    return { spec: { ...EMPTY }, source: 'no_ai' };
  }

  try {
    const provider = await getDefaultProvider();
    const messages: AIMessage[] = [{ role: 'user', content: description.trim() }];
    const response = await sendAIMessage({
      provider,
      messages,
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 1024,
    });
    return { spec: parseSpec(response.content), source: 'ai' };
  } catch (error) {
    // NOTE: quota / rate-limit CLI failures are external causes no code change can
    // fix — log at WARN so log-health-check does not re-file them as severity-high
    // bugs (task #639). auth (user-actionable) and unclassified stay ERROR.
    const reason =
      error instanceof ClaudeCliUnavailableError ? error.classification?.reason : undefined;
    if (reason === 'quota' || reason === 'rate_limit') {
      logger.warn({ err: error }, '[task-spec-deriver] derive failed (external AI cause)');
    } else {
      logger.error({ err: error }, '[task-spec-deriver] derive failed');
    }
    return { spec: { ...EMPTY }, source: 'ai_error' };
  }
}
