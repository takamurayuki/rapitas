/**
 * ガントチャートページ
 *
 * プロジェクトのタスクをガントチャートで表示するページ
 */

'use client';

import React from 'react';
import { GanttView } from '@/feature/tasks/components/gantt';

export default function GanttPage() {

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            ガントチャート
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            プロジェクトのタスクとその依存関係を時系列で確認できます。
          </p>
        </div>

        {/* ガントチャート */}
        <GanttView className="shadow-lg" />
      </div>
    </div>
  );
}