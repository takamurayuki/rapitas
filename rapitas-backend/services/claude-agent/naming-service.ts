import { sendAIMessage, type AIProvider, type AIMessage } from '../../utils/ai-client';
import {
  extractBranchName,
  sanitizeBranchName,
  isValidBranchName,
  generateFallbackBranchName,
} from '../../utils/branch-name-generator';

/**
 * タスク情報から意味のあるブランチ名を生成する
 */
export async function generateBranchName(
  taskTitle: string,
  taskDescription?: string | null,
  provider?: AIProvider,
  model?: string,
): Promise<{ branchName: string }> {
  const systemPrompt = `You are a Git branch name generator. Output ONLY a branch name, nothing else.

Rules:
- Prefix: feature/ (new feature), bugfix/ (bug fix), chore/ (other work), refactor/, docs/
- English only, lowercase kebab-case
- MUST have at least 2 words after the prefix, joined by hyphens (e.g., "add-auth" not "auth")
- Describe WHAT the task does in 2-5 words after the prefix
- Max 50 characters total
- If the input is in Japanese, translate the core meaning to English

Examples:
- Task: "ユーザー認証機能を追加" -> feature/add-user-authentication
- Task: "ログインボタンが動かないバグ" -> bugfix/fix-login-button
- Task: "依存関係の更新" -> chore/update-dependencies
- Task: "ダッシュボードにグラフ表示" -> feature/add-dashboard-charts
- Task: "APIレスポンスのキャッシュ実装" -> feature/add-api-response-cache`;

  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `Task title: "${taskTitle}"${taskDescription ? `\nTask description: "${taskDescription}"` : ''}\n\nGenerate a branch name:`,
    },
  ];

  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      messages,
      systemPrompt,
      maxTokens: 100,
    });

    let branchName = extractBranchName(response.content);
    branchName = sanitizeBranchName(branchName);

    if (!isValidBranchName(branchName)) {
      return { branchName: generateFallbackBranchName(taskTitle) };
    }

    return { branchName };
  } catch {
    return { branchName: generateFallbackBranchName(taskTitle) };
  }
}

/**
 * タスクの説明から簡潔なタイトルを自動生成する
 */
export async function generateTaskTitle(
  description: string,
  provider?: AIProvider,
  model?: string,
): Promise<{ title: string }> {
  const systemPrompt = `あなたはタスク管理のアシスタントです。
タスクの説明文から、簡潔で分かりやすいタスクタイトルを生成してください。

タイトルのルール:
1. 日本語で記述する
2. 必ず40文字以内に収めること（これは厳守）
3. 動詞を含めて何をするか明確にする
4. 余計な装飾や説明は不要
5. 説明が長くても要点だけを抽出して短くまとめる

出力形式: タイトルのみを出力してください。`;

  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `以下のタスク説明から、簡潔なタイトルを生成してください:\n\n${description}`,
    },
  ];

  const response = await sendAIMessage({
    provider: 'ollama',
    messages,
    systemPrompt,
    maxTokens: 50,
  });

  let title = response.content.trim().replace(/^["'「」『』]|["'「」『』]$/g, '');
  if (title.length > 40) {
    title = title.slice(0, 40);
  }
  return { title };
}
