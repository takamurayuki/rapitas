/**
 * DependencyAnalyzer / Utils
 *
 * Pure utility functions for file-path extraction and priority weighting.
 * Not responsible for graph construction or scheduling logic.
 */

import type { TaskPriority } from '../types';

/**
 * Extract file paths referenced in free-form text.
 *
 * @param text - Raw text to scan / スキャン対象のテキスト
 * @returns Deduplicated, normalised (lowercase, forward-slash) file paths / 重複排除・正規化されたファイルパスの配列
 */
export function extractFilePaths(text: string | null | undefined): string[] {
  if (!text) return [];

  const patterns = [
    // Unix/Mac absolute paths
    /(?:^|\s|["'`])([\/][\w\-\.\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // Windows absolute paths
    /(?:^|\s|["'`])([A-Za-z]:[\\\/][\w\-\.\\\/]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // Relative paths (./... or ../...)
    /(?:^|\s|["'`])(\.{0,2}[\/\\][\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
    // Common source-tree prefixes (src/components/..., etc.)
    /(?:^|\s|["'`])((?:src|lib|app|components|pages|features?|services?|utils?|hooks?|types?|api|routes?)[\w\-\.\/\\]+\.[a-zA-Z]{1,10})(?:\s|["'`]|$)/g,
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

      if (/\.[a-zA-Z]{1,10}$/.test(filePath)) {
        files.add(filePath);
      }
    }
  }
  return Array.from(files);
}

/**
 * Return the basename of a forward-slash-delimited path.
 *
 * @param path - File path / ファイルパス
 * @returns Basename / ベース名
 */
export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Map a task priority to a numeric scheduling weight.
 *
 * @param priority - Task priority level / タスク優先度
 * @returns Numeric weight (25–100) / 数値ウェイト（25〜100）
 */
export function priorityToWeight(priority: TaskPriority): number {
  switch (priority) {
    case 'urgent':
      return 100;
    case 'high':
      return 75;
    case 'medium':
      return 50;
    case 'low':
      return 25;
  }
}
