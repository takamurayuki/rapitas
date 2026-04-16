'use client';
// ToolSummaryCards

import { Package, Download, Key, RefreshCcw } from 'lucide-react';
import type { ToolsSummary } from './types';

interface ToolSummaryCardsProps {
  summary: ToolsSummary;
}

/**
 * Displays summary statistics for all CLI tools as a 2×2 / 4-column grid.
 *
 * @param summary - Aggregate counts fetched from the backend.
 */
export function ToolSummaryCards({ summary }: ToolSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              総ツール数
            </p>
            <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {summary.total}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
            <Download className="w-4 h-4 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              インストール済み
            </p>
            <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {summary.installed}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
            <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">認証済み</p>
            <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {summary.authenticated}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
            <RefreshCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">更新可能</p>
            <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {summary.needsUpdate}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
