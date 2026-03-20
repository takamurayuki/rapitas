/**
 * MemoSection utilities
 *
 * Pure helper functions and mock data generators for the MemoSection feature.
 * Does not depend on React; safe to import in non-component contexts.
 */

import type { MemoAnalysis, TaskActivity } from './types';

/**
 * Returns a human-readable relative time string for a given date.
 *
 * @param d - The date to format / フォーマットする日付
 * @returns Relative time string in Japanese / 日本語の相対時間文字列
 */
export const timeAgo = (d: Date): string => {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return '今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}日前`;
  return `${Math.floor(days / 30)}ヶ月前`;
};

/**
 * Generates mock task activity history for a given task.
 *
 * @param taskId - Numeric task identifier / タスクID
 * @returns Array of mock TaskActivity objects / モックのTaskActivityの配列
 */
export const generateMockTaskActivities = (taskId: number): TaskActivity[] => [
  {
    id: `${taskId}-1`,
    type: 'status_change',
    action: 'ステータスを変更',
    details: 'TODO → 進行中',
    user: 'システム',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    changes: { status: { from: 'todo', to: 'in-progress' } },
  },
  {
    id: `${taskId}-2`,
    type: 'priority_change',
    action: '優先度を変更',
    details: '中 → 高',
    user: 'ユーザー',
    timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    changes: { priority: { from: 'medium', to: 'high' } },
  },
  {
    id: `${taskId}-3`,
    type: 'assignment',
    action: 'タスクを作成',
    user: 'システム',
    timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
];

// HACK: Mock implementation — replace with actual AI API call when backend endpoint is ready.
/**
 * Performs a mock AI analysis of memo content, returning sentiment, keywords, and action items.
 *
 * @param content - Raw memo text to analyze / 分析するメモのテキスト
 * @returns Resolved MemoAnalysis object / MemoAnalysisオブジェクト
 */
export const analyzeMemo = async (content: string): Promise<MemoAnalysis> => {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const length = content.length;
  const hasActionWords = /実装|修正|追加|削除|テスト|確認|検討|調査/.test(content);
  const hasIssueWords = /問題|エラー|バグ|課題|困る|難しい|失敗/.test(content);
  const hasPositiveWords = /完了|成功|良い|改善|進捗|解決/.test(content);

  let importance: MemoAnalysis['importance'] = 'low';
  if (hasActionWords || hasIssueWords || length > 100) importance = 'medium';
  if (hasIssueWords && hasActionWords) importance = 'high';
  if (length > 200) importance = 'high';

  let sentiment: MemoAnalysis['sentiment'] = 'neutral';
  if (hasPositiveWords) sentiment = 'positive';
  if (hasIssueWords) sentiment = 'negative';

  const keywords: string[] = [];
  const keywordMatches =
    content.match(/\b[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]+\b/g) || [];
  const commonWords = [
    'です',
    'ます',
    'した',
    'する',
    'ある',
    'この',
    'その',
    'たり',
  ];
  keywordMatches.forEach((word) => {
    if (
      word.length >= 2 &&
      !commonWords.includes(word) &&
      !keywords.includes(word)
    ) {
      keywords.push(word);
    }
  });

  const actionItems: string[] = [];
  const actionMatches = content.match(/[・\-\*]\s*(.+)/g) || [];
  actionMatches.forEach((match) => {
    const item = match.replace(/^[・\-\*]\s*/, '').trim();
    if (item) actionItems.push(item);
  });

  let summary =
    content.length > 50 ? content.substring(0, 47) + '...' : content;

  if (hasActionWords) summary = `${summary} (アクション項目を含む)`;
  if (hasIssueWords) summary = `${summary} (課題を報告)`;

  return {
    summary,
    importance,
    keywords: keywords.slice(0, 5),
    sentiment,
    actionItems: actionItems.slice(0, 3),
    analyzedAt: new Date().toISOString(),
  };
};
