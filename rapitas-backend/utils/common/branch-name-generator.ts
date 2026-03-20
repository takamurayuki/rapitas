import { sendAIMessage } from '../ai-client';
import { createLogger } from '../../config/logger';

const log = createLogger('branch-name-generator');

/**
 * Generate a suitable branch name using AI based on task content.
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
- MUST have at least 2 words after the prefix, joined by hyphens (e.g., "add-auth" not "auth")
- Describe WHAT the task does in 2-5 words after the prefix
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

    // Sanitize and validate
    branchName = sanitizeBranchName(branchName);

    if (!isValidBranchName(branchName)) {
      throw new Error(`Generated branch name is invalid: ${branchName}`);
    }

    return branchName;
  } catch (error) {
    log.error({ err: error }, 'Error generating branch name with AI');
    // Fallback: generate name from task title
    return generateFallbackBranchName(taskTitle);
  }
}

/**
 * Extract the branch name portion from raw LLM output.
 */
export function extractBranchName(raw: string): string {
  let text = raw.trim();

  // Strip markdown code blocks
  text = text.replace(/```[^\n]*\n?/g, '').replace(/```/g, '');

  // Strip backticks
  text = text.replace(/`/g, '');

  // Take only the first line (in case LLM appended explanatory text)
  text = text.split('\n')[0].trim();

  // Remove surrounding quotes
  text = text.replace(/^["']+|["']+$/g, '');

  // Remove "branch name: xxx" style prefixes
  text = text.replace(/^(branch\s*name\s*[:：]\s*)/i, '');

  // Extract the portion starting with a valid prefix
  const prefixMatch = text.match(/((?:feature|bugfix|chore|fix|refactor|docs)\/[\w-]+)/);
  if (prefixMatch) {
    text = prefixMatch[1];
  }

  // Normalize fix/ to bugfix/
  if (text.startsWith('fix/')) {
    text = 'bugfix/' + text.slice(4);
  }

  return text.trim();
}

/**
 * Sanitize a branch name to a Git-compatible format.
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-\/]/g, '-') // Allow only Git-compatible characters
    .replace(/-+/g, '-') // Collapse consecutive hyphens
    .replace(/^-|-$/g, '') // Strip leading/trailing hyphens
    .substring(0, 50) // Enforce length limit
    .replace(/-$/, ''); // Re-check trailing hyphen after truncation
}

/**
 * Check whether a branch name follows Git naming conventions.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length === 0) return false;
  if (name.length > 50) return false;

  // Check for valid prefix
  const validPrefixes = ['feature/', 'bugfix/', 'chore/', 'refactor/', 'docs/'];
  if (!validPrefixes.some((prefix) => name.startsWith(prefix))) {
    return false;
  }

  // Branch name must have at least 2 words (one hyphen) after the prefix
  const prefixEnd = name.indexOf('/');
  const slug = name.substring(prefixEnd + 1);
  if (!slug.includes('-')) return false;

  // Git naming rules: disallow special characters, spaces, consecutive dots, etc.
  const invalidChars = /[\s~^:?*\[\\@{;`"'<>|]/;
  if (invalidChars.test(name)) return false;

  // Disallow consecutive dots, leading/trailing dots or hyphens
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
 * Generate a fallback branch name when AI generation fails.
 */
export function generateFallbackBranchName(taskTitle: string): string {
  const sanitizedTitle = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Keep only alphanumeric and spaces
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .substring(0, 40); // Length limit (accounting for feature/ prefix)

  // Default to feature/ prefix
  let prefix = 'feature/';

  // Determine prefix based on keywords
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

  // NOTE: Ensure at least 2 words after prefix — single-word slugs are rejected by isValidBranchName().
  let slug = sanitizedTitle || 'task';
  if (!slug.includes('-')) {
    const verbMap: Record<string, string> = {
      'feature/': 'implement',
      'bugfix/': 'fix',
      'chore/': 'update',
    };
    slug = `${verbMap[prefix] || 'implement'}-${slug}`;
  }

  const branchName = `${prefix}${slug}`;
  return sanitizeBranchName(branchName);
}
