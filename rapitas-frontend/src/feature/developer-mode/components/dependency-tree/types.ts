/**
 * dependency-tree/types
 *
 * Shared type definitions for the DependencyTree component family.
 * No React imports or side effects — safe to import from server components.
 */

export type DependencyInfo = {
  taskId: number;
  title: string;
  files: string[];
  dependencies: Array<{
    taskId: number;
    title: string;
    sharedFiles: string[];
    dependencyScore: number;
  }>;
  independenceScore: number;
  canRunParallel: boolean;
};

export type TreeNode = {
  id: number;
  title: string;
  files: string[];
  independenceScore: number;
  canRunParallel: boolean;
  level: number;
  children: TreeNode[];
  dependsOn: Array<{ id: number; title: string; sharedFiles: string[] }>;
};

export type ParallelGroup = {
  groupId: number;
  tasks: Array<{ id: number; title: string }>;
  canRunTogether: boolean;
};

export type AnalysisResult = {
  taskId: number;
  taskTitle: string;
  hasSubtasks: boolean;
  subtaskCount: number;
  analysis: DependencyInfo[];
  tree: TreeNode[];
  parallelGroups: ParallelGroup[];
  summary: {
    totalTasks: number;
    independentTasks: number;
    dependentTasks: number;
    totalFiles: number;
    averageIndependence: number;
  };
};

/**
 * Returns a Tailwind text color class based on independence score.
 *
 * @param score - independence score 0–100 / 独立スコア0〜100
 * @returns Tailwind color class / Tailwindカラークラス
 */
export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600 dark:text-green-400';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Returns a Tailwind background color class based on independence score.
 *
 * @param score - independence score 0–100 / 独立スコア0〜100
 * @returns Tailwind bg class / TailwindバックグラウンドCSSクラス
 */
export function getScoreBgColor(score: number): string {
  if (score >= 80) return 'bg-green-100 dark:bg-green-900/30';
  if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30';
  return 'bg-red-100 dark:bg-red-900/30';
}
