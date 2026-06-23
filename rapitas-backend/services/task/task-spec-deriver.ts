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
    logger.error({ err: error }, '[task-spec-deriver] derive failed');
    return { spec: { ...EMPTY }, source: 'ai_error' };
  }
}
