import { sendAIMessage, type AIProvider, type AIMessage } from '../../utils/ai-client';
import {
  extractBranchName,
  sanitizeBranchName,
  isValidBranchName,
  generateFallbackBranchName,
} from '../../utils/common/branch-name-generator';
import { cleanGeneratedTitle } from '../../utils/common/title-cleaner';

export { cleanGeneratedTitle } from '../../utils/common/title-cleaner';

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
 *
 * @param description - タスクの説明文 / task description text
 * @param provider - 使用するAIプロバイダー / AI provider to use
 * @param model - 使用するモデル名 / model name (optional)
 * @returns 生成されたタイトル / generated title
 */
export async function generateTaskTitle(
  description: string,
  provider?: AIProvider,
  model?: string,
): Promise<{ title: string }> {
  const systemPrompt = `あなたはタスク管理のアシスタントです。
タスクの説明文から、簡潔で分かりやすいタスクタイトルを1つだけ生成してください。

## ルール
1. 日本語で記述する（英語の技術用語はそのまま可: API、UI、DB等）
2. 必ず40文字以内に収める
3. 体言止め（名詞で終わる形）にする
4. 「〜の実装」「〜の修正」「〜の追加」「〜の改善」「〜の最適化」のような形式が望ましい
5. タイトルのみを出力する。説明、句読点、引用符、番号は一切不要
6. ハイフン(-)は使用禁止。読点(、)や句点(。)も使用禁止

## 入力が短い場合
- 1〜3単語の入力でも、意味が通るタイトルに整形する
- 例: 「ログイン バグ」→「ログイン機能のバグ修正」
- 例: 「ダークモード」→「ダークモード対応」

## 良い例
- ユーザー認証機能の実装
- データベース接続エラーの修正
- APIレスポンス速度の最適化
- 管理画面デザインの改善
- タスク一覧の並び替え機能追加
- メール通知テンプレートの更新

## 悪い例（これらは絶対に出力しないこと）
- 「ユーザー認証機能の実装」（引用符付き）
- ユーザー認証機能を実装する。（句点・動詞終わり）
- 1. ユーザー認証（番号付き）
- タイトル: ユーザー認証（プレフィックス付き）
- user-auth-implementation（英語ハイフン区切り）
- ユーザー認証 - 実装（ハイフン区切り）`;

  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `以下のタスク説明から、簡潔なタイトルを1つだけ生成してください:\n\n${description}`,
    },
  ];

  // NOTE: provider引数をsendAIMessageに渡す。未指定時はollamaにフォールバック。
  const response = await sendAIMessage({
    provider: provider ?? 'ollama',
    messages,
    systemPrompt,
    maxTokens: 80,
  });

  const title = cleanGeneratedTitle(response.content);
  return { title };
}

