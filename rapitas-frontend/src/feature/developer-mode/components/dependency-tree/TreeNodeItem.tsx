'use client';

/**
 * TreeNodeItem
 *
 * Recursive tree node component for the dependency tree view.
 * Renders a collapsible row with independence score, file count, and dependency details.
 */

import {
  FileCode,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Link2,
} from 'lucide-react';
import { getScoreColor, getScoreBgColor, type TreeNode } from './types';

interface TreeNodeItemProps {
  node: TreeNode;
  isExpanded: boolean;
  onToggle: () => void;
  /** @param depth - nesting depth for indentation / インデント用ネスト深さ */
  depth?: number;
}

/**
 * Single collapsible tree node showing title, score, files, and dependency info.
 *
 * @param props - TreeNodeItemProps
 */
export function TreeNodeItem({
  node,
  isExpanded,
  onToggle,
  depth = 0,
}: TreeNodeItemProps) {
  const hasChildren = node.children.length > 0;
  const hasDependencies = node.dependsOn.length > 0;

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
          depth > 0
            ? 'ml-6 border-l-2 border-zinc-200 dark:border-zinc-700'
            : ''
        }`}
      >
        <button
          onClick={onToggle}
          className={`p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
            !hasChildren && !hasDependencies ? 'invisible' : ''
          }`}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {node.canRunParallel ? (
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        )}

        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1">
          {node.title}
        </span>

        <span
          className={`px-2 py-0.5 text-xs rounded ${getScoreBgColor(node.independenceScore)} ${getScoreColor(node.independenceScore)}`}
        >
          {node.independenceScore}%
        </span>

        {node.files.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <FileCode className="w-3 h-3" />
            {node.files.length}
          </span>
        )}
      </div>

      {isExpanded && (
        <div className="ml-10 mt-1 space-y-2">
          {hasDependencies && (
            <div className="p-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 mb-1">
                <Link2 className="w-3 h-3" />
                <span className="font-medium">Dependencies</span>
              </div>
              <div className="space-y-1">
                {node.dependsOn.map((dep) => (
                  <div
                    key={dep.id}
                    className="text-xs text-amber-600 dark:text-amber-400"
                  >
                    <span className="font-medium">{dep.title}</span>
                    <span className="text-amber-500 dark:text-amber-500 ml-2">
                      ({dep.sharedFiles.join(', ')})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {node.files.length > 0 && (
            <div className="p-2 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                <FileCode className="w-3 h-3" />
                <span className="font-medium">Related Files</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {node.files.slice(0, 10).map((file, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded font-mono"
                  >
                    {file.split('/').pop()}
                  </span>
                ))}
                {node.files.length > 10 && (
                  <span className="text-xs text-zinc-500">
                    +{node.files.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}

          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              isExpanded={false}
              onToggle={() => {}}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
