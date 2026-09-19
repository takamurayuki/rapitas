/**
 * PromptEvolutionTree display utilities
 *
 * Pure formatting helpers for rendering a `PromptEvolutionTreeNode` tree —
 * separate from the backend's `prompt-evolution-tree.ts` (which builds the
 * tree and derives treeConfidence); this module only reshapes an already-built
 * tree for display (flattening for rows, badge color classes).
 */
import type { PromptEvolutionTreeNode, TreeConfidence } from './prompt-evolution-tree.types';

/** One flattened row: a node plus its depth in the tree, for indent-based rendering. */
export interface FlattenedTreeRow {
  node: PromptEvolutionTreeNode;
  depth: number;
}

/**
 * Flattens a forest of trees into a depth-first, pre-order row list so the
 * tree can render as a simple indented list rather than requiring recursive
 * JSX at every level.
 *
 * @param roots - Root nodes returned by `GET /learning/prompt-evolution/tree`. / ルートノード配列
 * @returns Depth-first flattened rows. / 深さ優先の行リスト
 */
export function flattenTree(roots: PromptEvolutionTreeNode[]): FlattenedTreeRow[] {
  const rows: FlattenedTreeRow[] = [];
  const visit = (node: PromptEvolutionTreeNode, depth: number) => {
    rows.push({ node, depth });
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return rows;
}

/** Tailwind badge classes per confidence level, dark-mode aware. */
export const TREE_CONFIDENCE_BADGE_CLASS: Record<TreeConfidence, string> = {
  high: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  low: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400',
};

/**
 * Formats a `performanceDelta` as a signed percentage-point string for
 * display (e.g. `+3.2pt`, `-1.0pt`, `0.0pt`).
 *
 * @param delta - Raw performance delta (fraction, e.g. 0.032). / 性能差分（比率）
 * @returns Signed percentage-point string. / 表示用文字列
 */
export function formatPerformanceDelta(delta: number): string {
  const pt = delta * 100;
  const sign = pt > 0 ? '+' : '';
  return `${sign}${pt.toFixed(1)}pt`;
}

/**
 * Counts how many of a node's 5 required attributes (task #937 受入条件2) are
 * actually populated vs. recorded-as-empty, for a lightweight completeness
 * indicator. Every attribute is always PRESENT on a node (the schema
 * guarantees this) — this only distinguishes "has a value" from "explicitly
 * null/false/empty", it is not a validity check.
 *
 * @param node - A tree node. / 対象ノード
 * @returns Count of populated attributes out of 5. / 値ありの属性数(5点満点)
 */
export function countPopulatedAttributes(node: PromptEvolutionTreeNode): number {
  let count = 0;
  if (node.taskType) count++;
  if (node.significanceLevel !== null) count++;
  if (node.abComparisonRef !== null) count++;
  if (node.applicableConditions.dayOfWeek || node.applicableConditions.modelVersion) count++;
  if (node.failureCases.length > 0) count++;
  return count;
}
