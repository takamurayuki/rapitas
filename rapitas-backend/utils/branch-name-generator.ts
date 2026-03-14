import { sendAIMessage } from './ai-client';
import { createLogger } from '../config/logger';

const log = createLogger('branch-name-generator');

/**
 * タスクの内容に基づいて適切なブランチ名をAIで生成する
 */
export async function generateBranchName(
  taskTitle: string,
  taskDescription?: string,
): Promise<string> {
  try {
    const systemPrompt = `You are a Git branch name generator. Output ONLY a branch name, nothing else.

Rules:
- Prefix: feature/ (new feature), bugfix/ (bug fix), chore/ (other work)
- English only, lowercase kebab-case
- Describe WHAT the task does in 3-5 words after the prefix
- Max 50 characters total
- If the input is in Japanese, translate the core meaning to English

Examples:
- Task: "ユーザー認証機能を追加" -> feature/add-user-authentication
- Task: "ログインボタンが動かないバグ" -> bugfix/fix-login-button
- Task: "依存関係の更新" -> chore/update-dependencies
- Task: "ダッシュボードにグラフ表示" -> feature/add-dashboard-charts
- Task: "APIレスポンスのキャッシュ実装" -> feature/add-api-response-cache
- Task: "メール通知の送信エラー修正" -> bugfix/fix-email-notification-error`;

    const userMessage = `Task title: "${taskTitle}"${taskDescription ? `\nTask description: "${taskDescription}"` : ''}\n\nGenerate a branch name:`;

    const response = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens: 100,
    });

    let branchName = extractBranchName(response.content);

    // サニタイズとバリデーション
    branchName = sanitizeBranchName(branchName);

    if (!isValidBranchName(branchName)) {
      throw new Error(`Generated branch name is invalid: ${branchName}`);
    }

    return branchName;
  } catch (error) {
    log.error({ err: error }, 'Error generating branch name with AI');
    // フォールバック: タスクタイトルベースの命名
    return generateFallbackBranchName(taskTitle);
  }
}

/**
 * LLMの出力からブランチ名部分を抽出する
 */
export function extractBranchName(raw: string): string {
  let text = raw.trim();

  // マークダウンのコードブロックを除去
  text = text.replace(/```[^\n]*\n?/g, '').replace(/```/g, '');

  // バッククォートを除去
  text = text.replace(/`/g, '');

  // 最初の行のみ取得（LLMが説明文を付加した場合）
  text = text.split('\n')[0].trim();

  // 前後の引用符を削除
  text = text.replace(/^["']+|["']+$/g, '');

  // "branch name: xxx" のようなプレフィックスを除去
  text = text.replace(/^(branch\s*name\s*[:：]\s*)/i, '');

  // 有効なプレフィックスで始まる部分を抽出
  const prefixMatch = text.match(/((?:feature|bugfix|chore|fix|refactor|docs)\/[\w-]+)/);
  if (prefixMatch) {
    text = prefixMatch[1];
  }

  // fix/ を bugfix/ に正規化
  if (text.startsWith('fix/')) {
    text = 'bugfix/' + text.slice(4);
  }

  return text.trim();
}

/**
 * ブランチ名をGit互換の形式にサニタイズする
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-\/]/g, '-') // Git互換文字のみ許可
    .replace(/-+/g, '-') // 連続するハイフンを1つに
    .replace(/^-|-$/g, '') // 先頭・末尾のハイフンを削除
    .substring(0, 50) // 長さ制限
    .replace(/-$/, ''); // 末尾のハイフンを再度チェック
}

/**
 * ブランチ名がGitの命名規則に従っているかチェック
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.length > 50) return false;

  // 有効なプレフィックスをチェック
  const validPrefixes = ['feature/', 'bugfix/', 'chore/', 'refactor/', 'docs/'];
  if (!validPrefixes.some((prefix) => name.startsWith(prefix))) {
    return false;
  }

  // Git命名規則: 特殊文字やスペース、連続するドットなどを禁止
  const invalidChars = /[\s~^:?*\[\\@{;`"'<>|]/;
  if (invalidChars.test(name)) return false;

  // 連続するドット、先頭末尾のドットやハイフンを禁止
  if (
    name.includes('..') ||
    name.startsWith('.') ||
    name.endsWith('.') ||
    name.startsWith('-') ||
    name.endsWith('-')
  ) {
    return false;
  }

  return true;
}

/**
 * AI生成が失敗した場合のフォールバックブランチ名を生成
 */
export function generateFallbackBranchName(taskTitle: string): string {
  // タスクタイトルからブランチ名を生成
  const sanitizedTitle = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // 英数字とスペースのみ
    .trim()
    .replace(/\s+/g, '-') // スペースをハイフンに
    .substring(0, 40); // 長さ制限（feature/を考慮）

  // デフォルトは feature/ プレフィックス
  let prefix = 'feature/';

  // キーワードベースでプレフィックスを決定
  const bugKeywords = ['fix', 'bug', 'error', '修正', 'バグ', 'エラー'];
  const choreKeywords = [
    'refactor',
    'update',
    'clean',
    'remove',
    'delete',
    '更新',
    '削除',
    'リファクタ',
  ];

  const titleLower = taskTitle.toLowerCase();
  if (bugKeywords.some((keyword) => titleLower.includes(keyword))) {
    prefix = 'bugfix/';
  } else if (choreKeywords.some((keyword) => titleLower.includes(keyword))) {
    prefix = 'chore/';
  }

  const branchName = `${prefix}${sanitizedTitle || 'task'}`;
  return sanitizeBranchName(branchName);
}
