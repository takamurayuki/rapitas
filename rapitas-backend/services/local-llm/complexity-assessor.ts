/**
 * Task Complexity Assessor
 *
 * Evaluates task complexity to decide whether a local LLM can handle a
 * given workflow phase. Low-complexity phases (researcher, verifier) are
 * routed to Ollama; high-complexity phases (implementer, planner) stay
 * on the paid API.
 */
import { createLogger } from '../../config';

const log = createLogger('local-llm:complexity-assessor');

/** Complexity levels used for routing decisions. */
export type ComplexityLevel = 'low' | 'medium' | 'high';

/** Result of a complexity assessment. */
export interface ComplexityAssessment {
  level: ComplexityLevel;
  score: number;
  reasons: string[];
  canUseLocalLLM: boolean;
}

/** Workflow roles that can be delegated to local LLM when complexity is low. */
const LOCAL_LLM_ELIGIBLE_ROLES = new Set(['researcher', 'verifier']);

/** Keywords that indicate high complexity. */
const HIGH_COMPLEXITY_KEYWORDS = [
  'migration', 'database schema', 'security', 'authentication', 'authorization',
  'performance optimization', 'architecture', 'refactor entire', 'breaking change',
  'multi-service', 'distributed', 'concurrent', 'race condition',
  'マイグレーション', 'データベーススキーマ', 'セキュリティ', '認証', '認可',
  'パフォーマンス最適化', 'アーキテクチャ', '全体リファクタ', '破壊的変更',
];

/** Keywords that indicate low complexity. */
const LOW_COMPLEXITY_KEYWORDS = [
  'typo', 'rename', 'comment', 'documentation', 'style', 'format',
  'label', 'color', 'text change', 'copy change', 'bump version',
  'タイポ', '名前変更', 'コメント', 'ドキュメント', 'スタイル',
  'ラベル', '色変更', 'テキスト変更', 'バージョン更新',
];

/**
 * Assess the complexity of a task for a given workflow role.
 *
 * Scoring:
 * - Base score from task text analysis (keywords, length)
 * - Role modifier (implementer/planner always high)
 * - Context length modifier
 *
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param role - Workflow role being executed. / 実行中のワークフローロール
 * @param contextLength - Character length of the assembled context. / コンテキストの文字数
 * @returns Complexity assessment with routing decision. / ルーティング判定付きの複雑度評価
 */
export function assessComplexity(
  task: { title: string; description: string | null },
  role: string,
  contextLength: number = 0,
): ComplexityAssessment {
  const reasons: string[] = [];
  let score = 50; // Start at medium

  const text = `${task.title} ${task.description || ''}`.toLowerCase();

  // Keyword analysis
  const highMatches = HIGH_COMPLEXITY_KEYWORDS.filter((kw) => text.includes(kw.toLowerCase()));
  const lowMatches = LOW_COMPLEXITY_KEYWORDS.filter((kw) => text.includes(kw.toLowerCase()));

  if (highMatches.length > 0) {
    score += highMatches.length * 15;
    reasons.push(`High-complexity keywords: ${highMatches.join(', ')}`);
  }
  if (lowMatches.length > 0) {
    score -= lowMatches.length * 15;
    reasons.push(`Low-complexity keywords: ${lowMatches.join(', ')}`);
  }

  // Description length — longer descriptions often mean more complex tasks
  const descLength = (task.description || '').length;
  if (descLength > 1000) {
    score += 15;
    reasons.push(`Long description (${descLength} chars)`);
  } else if (descLength < 100) {
    score -= 10;
    reasons.push(`Short description (${descLength} chars)`);
  }

  // Context length — more context = more complex understanding needed
  if (contextLength > 5000) {
    score += 10;
    reasons.push(`Large context (${contextLength} chars)`);
  }

  // Role modifier — implementer and planner always require strong reasoning
  if (role === 'implementer' || role === 'planner') {
    score += 30;
    reasons.push(`Role "${role}" requires strong reasoning`);
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  const level: ComplexityLevel = score <= 35 ? 'low' : score <= 65 ? 'medium' : 'high';
  const canUseLocalLLM = level === 'low' && LOCAL_LLM_ELIGIBLE_ROLES.has(role);

  log.debug({ task: task.title, role, score, level, canUseLocalLLM }, 'Complexity assessed');

  return { level, score, reasons, canUseLocalLLM };
}
