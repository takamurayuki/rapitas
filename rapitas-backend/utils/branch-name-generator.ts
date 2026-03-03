import { sendAIMessage } from './ai-client';

/**
 * タスクの内容に基づいて適切なブランチ名をAIで生成する
 */
export async function generateBranchName(taskTitle: string, taskDescription?: string): Promise<string> {
  try {
    // タスク内容からブランチ名を生成するプロンプト
    const prompt = `
タスクのタイトルと説明から、Git命名規則に従った適切なブランチ名を生成してください。

タスクタイトル: "${taskTitle}"
${taskDescription ? `タスク説明: "${taskDescription}"` : ''}

要件:
1. プレフィックス: "feature/" または "bugfix/" または "chore/" のいずれかを選択
   - 新機能・機能追加: feature/
   - バグ修正: bugfix/
   - その他の作業: chore/
2. 英語のみ使用
3. ケバブケース（小文字・ハイフン区切り）
4. 30文字以内で簡潔に
5. 特殊文字（/, ?, :, @, &, =, +, $, ,）は使用禁止

ブランチ名のみを回答してください（例: feature/add-user-authentication）
    `.trim();

    const response = await sendAIMessage(prompt, {
      maxTokens: 100,
      temperature: 0.3, // より一貫性のある出力のため低めに設定
    });

    let branchName = response.trim();

    // 前後の引用符を削除
    if ((branchName.startsWith('"') && branchName.endsWith('"')) ||
        (branchName.startsWith("'") && branchName.endsWith("'"))) {
      branchName = branchName.slice(1, -1);
    }

    // サニタイズとバリデーション
    branchName = sanitizeBranchName(branchName);

    if (!isValidBranchName(branchName)) {
      throw new Error(`Generated branch name is invalid: ${branchName}`);
    }

    return branchName;
  } catch (error) {
    console.error('Error generating branch name with AI:', error);
    // フォールバック: タスクタイトルベースの命名
    return generateFallbackBranchName(taskTitle);
  }
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
  const validPrefixes = ['feature/', 'bugfix/', 'chore/'];
  if (!validPrefixes.some(prefix => name.startsWith(prefix))) {
    return false;
  }

  // Git命名規則: 特殊文字やスペース、連続するドットなどを禁止
  const invalidChars = /[\s~^:?*\[\\@{;`"'<>|]/;
  if (invalidChars.test(name)) return false;

  // 連続するドット、先頭末尾のドットやハイフンを禁止
  if (name.includes('..') || name.startsWith('.') || name.endsWith('.') ||
      name.startsWith('-') || name.endsWith('-')) {
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
  const choreKeywords = ['refactor', 'update', 'clean', 'remove', 'delete', '更新', '削除', 'リファクタ'];

  const titleLower = taskTitle.toLowerCase();
  if (bugKeywords.some(keyword => titleLower.includes(keyword))) {
    prefix = 'bugfix/';
  } else if (choreKeywords.some(keyword => titleLower.includes(keyword))) {
    prefix = 'chore/';
  }

  const branchName = `${prefix}${sanitizedTitle || 'task'}`;
  return sanitizeBranchName(branchName);
}