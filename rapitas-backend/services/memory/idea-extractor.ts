/**
 * Idea Extractor
 *
 * Extracts improvement ideas from execution logs and copilot conversations.
 * Prefers Ollama (local LLM, free) with Haiku fallback for cost optimization.
 */
import { createLogger } from '../../config/logger';
import { getLocalLLMStatus } from '../local-llm';
import { sendAIMessage } from '../../utils/ai-client';
import { submitIdea } from './idea-box-service';

const log = createLogger('memory:idea-extractor');

/** Minimum conversation length before extracting ideas from copilot chat. */
const MIN_CHAT_LENGTH = 5;

const EXTRACTION_PROMPT = `あなたはソフトウェア開発のアイデアアナリストです。
以下のコンテンツから、今後の���善に役立つ実行可能なアイデアを抽出してください。

ルール:
- 具体的で実行可能なアイデアのみ（「検討する」ではなく「実装する」）
- 既に完了した作業ではなく、未来の改善案
- カテゴリ: improvement（改善）, bug_noticed（発見したバグ）, tech_debt（技術的負債）, ux（UX改善）, feature（新機能）, performance（性能）
- 最大5件��で

以下のJSON配列で返してください（他のテキスト不要）:
[{"title":"短いタイトル","content":"具体的な説明","category":"improvement"}]

アイデアがない場合は空配列 [] を返してください。`;

/**
 * Extract ideas from agent execution results (verify.md + logs).
 * Called after task completion as fire-and-forget.
 *
 * @param taskId - Completed task ID / 完了タスクID
 * @param verifyContent - verify.md content / verify.mdの内容
 * @param executionLogs - Optional raw execution logs / 実行ログ
 * @returns Created idea IDs / 作成されたアイデアID
 */
export async function extractIdeasFromExecutionLog(
  taskId: number,
  verifyContent: string,
  executionLogs?: string,
): Promise<number[]> {
  if (!verifyContent && !executionLogs) return [];

  const context = [
    verifyContent ? `## 検証結果\n${verifyContent.slice(0, 2000)}` : '',
    executionLogs ? `## 実行ログ（抜粋）\n${executionLogs.slice(-1000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const ideas = await callLLMForIdeas(context);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        category: idea.category ?? 'improvement',
        taskId,
        source: 'agent_execution',
        confidence: 0.7,
      });
      ids.push(id);
    }

    log.info({ taskId, count: ids.length }, 'Ideas extracted from execution');
    return ids;
  } catch (err) {
    log.warn({ err, taskId }, 'Idea extraction from execution failed (non-critical)');
    return [];
  }
}

/**
 * Extract ideas from a copilot chat conversation.
 * Triggered periodically during longer conversations.
 *
 * @param history - Conversation messages / 会話履歴
 * @param taskId - Optional associated task ID / 関連タスクID
 * @returns Created idea IDs / 作成されたアイデアID
 */
export async function extractIdeasFromCopilotChat(
  history: Array<{ role: string; content: string }>,
  taskId?: number,
): Promise<number[]> {
  if (history.length < MIN_CHAT_LENGTH) return [];

  // Use only the last 10 messages to keep context small
  const recent = history.slice(-10);
  const context = recent
    .map((m) => `${m.role === 'user' ? 'ユーザー' : 'AI'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  try {
    const ideas = await callLLMForIdeas(`## コパイロットの会話\n${context}`);
    const ids: number[] = [];

    for (const idea of ideas) {
      const id = await submitIdea({
        title: idea.title,
        content: idea.content,
        category: idea.category ?? 'improvement',
        taskId,
        source: 'copilot',
        confidence: 0.5,
      });
      ids.push(id);
    }

    log.info({ taskId, count: ids.length }, 'Ideas extracted from copilot chat');
    return ids;
  } catch (err) {
    log.warn({ err, taskId }, 'Idea extraction from copilot failed (non-critical)');
    return [];
  }
}

interface RawIdea {
  title: string;
  content: string;
  category?: string;
}

/**
 * Call LLM (Ollama preferred, Haiku fallback) to extract ideas from context.
 *
 * @param context - Text to analyze / ��析テキスト
 * @returns Parsed idea suggestions / 抽出されたアイデア
 */
async function callLLMForIdeas(context: string): Promise<RawIdea[]> {
  const localStatus = await getLocalLLMStatus().catch(() => ({ available: false }));
  const useLocal = (localStatus as { available: boolean }).available;

  const response = await sendAIMessage({
    provider: useLocal ? 'ollama' : 'claude',
    model: useLocal ? 'llama3.2' : 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user', content: `${EXTRACTION_PROMPT}\n\n---\n${context}` }],
    maxTokens: 800,
  });

  const text = response.content;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as RawIdea[];
  return parsed.filter((i) => i.title && i.content).slice(0, 5);
}
