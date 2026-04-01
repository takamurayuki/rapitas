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
タスクの説明文から、簡潔で分かりやすいタスクタイトルを生成してください。

タイトルのルール:
1. 日本語で記述する
2. 必ず40文字以内に収めること（これは厳守）
3. 体言止めでタイトルっぽく作成する（「。」「が」は絶対に使用禁止）
4. 余計な装飾や説明は不要
5. 説明が長くても要点だけを抽出して短くまとめる
6. 一文のみで出力する
7. ハイフン（-）や記号（・）、英語と日本語の混在は避ける
8. 「タイトル:」「件名:」などのプレフィックスは付けない
9. 短い入力（5文字以下）でも意味のあるタイトルを生成する

出力形式: タイトルのみを出力してください。句読点、記号、プレフィックスは使わないでください。

良い例:
- 「ユーザー認証機能の実装」
- 「データベース接続エラーの修正」
- 「API レスポンス速度の最適化」
- 「管理画面デザインの改善」
- 「ログイン画面の表示改善」
- 「画像アップロード機能追加」

悪い例:
- 「- ユーザー認証機能の実装」（ハイフン使用）
- 「ユーザー認証機能を実装する。」（句点使用）
- 「データベースが接続できない」（「が」使用）
- 「API のレスポンス速度を最適化します」（動詞の丁寧語）
- 「タイトル: ログイン機能追加」（プレフィックス使用）
- 「Login機能の追加」（英語混在）
- 「画面・修正」（記号使用）`;

  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `以下のタスク説明から、簡潔なタイトルを1つだけ生成してください:\n\n${description}`,
    },
  ];

  // NOTE: provider引数をsendAIMessageに渡す。未指定時はollamaにフォールバック。
  const response = await sendAIMessage({
    provider: provider || 'ollama',
    messages,
    systemPrompt,
    maxTokens: 50,
    model,
  });

  let title = response.content.trim();

  // LLMが生成しがちなプレフィックスを除去
  title = title.replace(/^(タイトル|件名|題名|テーマ)\s*[:：]\s*/g, '');
  title = title.replace(/^(Title|Subject)\s*[:：]\s*/gi, '');

  // 引用符・括弧の除去
  title = title.replace(/^["']+/g, '').replace(/["']+$/g, '');
  title = title.replace('「', '').replace('」', '');
  title = title.replace('『', '').replace('』', '');
  title = title.replace(/^[()（）]+/g, '').replace(/[()（）]+$/g, '');
  title = title.replace(/^[【】\[\]]+/g, '').replace(/[【】\[\]]+$/g, '');

  // ハイフンや不要な記号の除去（文頭のハイフンや箇条書きマーカー）
  title = title.replace(/^[-−・*+]\s*/g, '');
  title = title.replace(/\s*[-−・]\s*/g, ' '); // 中間のハイフンをスペースに置換

  // 「。」除去ロジック
  title = title.replace(/。+$/, '');

  // 複数文の場合は最初のもののみ返却
  if (title.includes('。')) {
    title = title.split('。')[0];
  }

  // 「が」が含まれている場合の安全な処理（破壊的な除去を避ける）
  if (title.includes('が')) {
    // より安全な「が」の処理：文法的におかしくなりそうな場合のみ修正
    title = title.replace(/(.+)が(.+)ない(問題|エラー|バグ)/g, '$1の$2修正');
    title = title.replace(/(.+)が(.+)できない/g, '$1の$2機能');
    // その他の「が」は残す（意味を壊さないため）
  }

  // 余分な空白を除去し、文字数制限を適用
  title = title.replace(/\s+/g, ' ').trim();
  if (title.length > 40) {
    title = title.slice(0, 40);
  }

  // 空文字列の場合のフォールバック
  if (!title) {
    title = 'タスクタイトル';
  }

  return { title };
}

