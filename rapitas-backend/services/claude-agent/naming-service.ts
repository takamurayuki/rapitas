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
3. 体言止めでタイトルっぽく作成する（「。」「が」は絶対に使用禁止）
4. 余計な装飾や説明は不要
5. 説明が長くても要点だけを抽出して短くまとめる
6. 一文のみで出力する

出力形式: タイトルのみを出力してください。句読点は使わないでください。

良い例:
- 「ユーザー認証機能の実装」
- 「データベース接続エラーの修正」
- 「API レスポンス速度の最適化」
- 「管理画面デザインの改善」

悪い例:
- 「ユーザー認証機能を実装する。」（句点使用）
- 「データベースが接続できない」（「が」使用）
- 「API のレスポンス速度を最適化します」（動詞の丁寧語）`;

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

  // 「。」除去ロジック
  title = title.replace(/。+$/, '');

  // 複数文の場合は最初のもののみ返却
  if (title.includes('。')) {
    title = title.split('。')[0];
  }

  // 「が」が含まれている場合は除去または修正を試行
  if (title.includes('が')) {
    // 簡単な「が」除去パターン
    title = title.replace(/が[あ-ん]+/g, '');
  }

  if (title.length > 40) {
    title = title.slice(0, 40);
  }
  return { title };
}
