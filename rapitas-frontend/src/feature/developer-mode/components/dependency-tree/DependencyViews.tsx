'use client';

/**
 * DependencyViews
 *
 * The three view modes (tree, list, groups) and the summary stats bar for the DependencyTree.
 * Each view is exported independently so the parent can switch between them.
 */

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Layers,
  Link2,
  Unlink,
  Zap,
} from 'lucide-react';
import { TreeNodeItem } from './TreeNodeItem';
import {
  getScoreBgColor,
  getScoreColor,
  type AnalysisResult,
  type TreeNode,
} from './types';

// ── Summary Stats ─────────────────────────────────────────────────────────────

interface SummaryStatsProps {
  summary: AnalysisResult['summary'];
}

/**
 * Four-column grid showing total, independent, dependent tasks and average independence.
 *
 * @param props - SummaryStatsProps
 */
export function SummaryStats({ summary }: SummaryStatsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1"><Layers className="w-3 h-3" />Tasks</div>
        <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{summary.totalTasks}</div>
      </div>
      <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mb-1"><Unlink className="w-3 h-3" />Independent</div>
        <div className="text-lg font-bold text-green-700 dark:text-green-300">{summary.independentTasks}</div>
      </div>
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-1"><Link2 className="w-3 h-3" />Dependent</div>
        <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{summary.dependentTasks}</div>
      </div>
      <div className="p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
        <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 mb-1"><Zap className="w-3 h-3" />Avg Independence</div>
        <div className="text-lg font-bold text-violet-700 dark:text-violet-300">{summary.averageIndependence}%</div>
      </div>
    </div>
  );
}

// ── Tree View ──────────────────────────────────────────────────────────────────

interface TreeViewProps {
  nodes: TreeNode[];
  expandedNodes: Set<number>;
  onToggle: (id: number) => void;
}

/**
 * Hierarchical tree view of task dependencies.
 *
 * @param props - TreeViewProps
 */
export function TreeView({ nodes, expandedNodes, onToggle }: TreeViewProps) {
  if (nodes.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No subtasks or prompts to analyze</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.id}
          node={node}
          isExpanded={expandedNodes.has(node.id)}
          onToggle={() => onToggle(node.id)}
        />
      ))}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────

interface ListViewProps {
  analysis: AnalysisResult['analysis'];
}

/**
 * Flat sorted list of tasks by independence score.
 *
 * @param props - ListViewProps
 */
export function ListView({ analysis }: ListViewProps) {
  return (
    <div className="space-y-2">
      {analysis
        .slice()
        .sort((a, b) => b.independenceScore - a.independenceScore)
        .map((item) => (
          <div
            key={item.taskId}
            className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {item.canRunParallel ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                )}
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {item.title}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 text-xs rounded ${getScoreBgColor(item.independenceScore)} ${getScoreColor(item.independenceScore)}`}
              >
                Independence: {item.independenceScore}%
              </span>
            </div>
            {item.dependencies.length > 0 && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium">Dependencies:</span>{' '}
                {item.dependencies.map((d) => d.title).join(', ')}
              </div>
            )}
            {item.files.length > 0 && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                <span className="font-medium">Files:</span> {item.files.length}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}

// ── Groups View ───────────────────────────────────────────────────────────────

interface GroupsViewProps {
  parallelGroups: AnalysisResult['parallelGroups'];
}

/**
 * Grouped view showing which tasks can run in parallel vs sequentially.
 *
 * @param props - GroupsViewProps
 */
export function GroupsView({ parallelGroups }: GroupsViewProps) {
  if (parallelGroups.length === 0) {
    return (
      <div className="text-center py-8 text-zinc-500">
        <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No tasks can be grouped</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parallelGroups.map((group) => (
        <div
          key={group.groupId}
          className={`p-4 rounded-lg border ${
            group.canRunTogether
              ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
              : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            {group.canRunTogether ? (
              <>
                <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  Parallel execution ({group.tasks.length} tasks)
                </span>
              </>
            ) : (
              <>
                <Link2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                  Sequential execution ({group.tasks.length} tasks)
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {group.tasks.map((task) => (
              <span
                key={task.id}
                className={`px-2 py-1 text-xs rounded ${
                  group.canRunTogether
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                }`}
              >
                {task.title}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
