'use client';

/**
 * PRFilesTab
 *
 * Files-changed tab content for the pull request detail page.
 * Renders a collapsible list of diff hunks for each changed file.
 */

import { FileCode, ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react';
import type { FileDiff } from '@/types';

interface PRFilesTabProps {
  diff: FileDiff[];
  expandedFiles: Set<string>;
  onToggleFile: (filename: string) => void;
}

/**
 * Renders the list of changed files with expandable diff hunks.
 *
 * @param props.diff - Array of file diffs / ファイル差分の配列
 * @param props.expandedFiles - Set of currently expanded filenames / 展開中のファイル名のセット
 * @param props.onToggleFile - Callback to toggle a file's expanded state / ファイルの展開状態トグルコールバック
 */
export function PRFilesTab({
  diff,
  expandedFiles,
  onToggleFile,
}: PRFilesTabProps) {
  return (
    <div className="space-y-2">
      {diff.map((file) => (
        <div
          key={file.filename}
          className="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        >
          <button
            onClick={() => onToggleFile(file.filename)}
            className="w-full flex items-center justify-between p-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {expandedFiles.has(file.filename) ? (
                <ChevronDown className="w-4 h-4 text-zinc-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-zinc-400" />
              )}
              <FileCode className="w-4 h-4 text-zinc-400" />
              <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                {file.filename}
              </span>
              <span
                className={`px-1.5 py-0.5 text-xs rounded ${
                  file.status === 'added'
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : file.status === 'removed'
                      ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                }`}
              >
                {file.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-600 dark:text-green-400 flex items-center gap-0.5">
                <Plus className="w-3 h-3" />
                {file.additions}
              </span>
              <span className="text-red-600 dark:text-red-400 flex items-center gap-0.5">
                <Minus className="w-3 h-3" />
                {file.deletions}
              </span>
            </div>
          </button>

          {expandedFiles.has(file.filename) && file.patch && (
            <div className="border-t border-zinc-200 dark:border-zinc-700">
              <pre className="p-4 text-xs font-mono overflow-x-auto bg-zinc-50 dark:bg-indigo-dark-900">
                {file.patch.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={`${
                      line.startsWith('+') && !line.startsWith('+++')
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                        : line.startsWith('-') && !line.startsWith('---')
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                          : line.startsWith('@@')
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                            : 'text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    {line}
                  </div>
                ))}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
