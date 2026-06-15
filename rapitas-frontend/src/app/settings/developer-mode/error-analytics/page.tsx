'use client';
/**
 * ErrorAnalyticsPage
 *
 * Settings sub-page that surfaces the backend error analytics dashboard.
 * Shows categorised ERROR/WARN counts, % share, and week-over-week trends
 * sourced from the daily pino log files.
 */

import { BarChart3, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { requireAuth } from '@/contexts/AuthContext';
import { ErrorAnalyticsDashboard } from '@/feature/developer-mode/components/error-analytics/ErrorAnalyticsDashboard';

function ErrorAnalyticsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back navigation */}
      <Link
        href="/settings/developer-mode"
        className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        開発モード設定に戻る
      </Link>

      {/* Page header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <BarChart3 className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            エラー分析ダッシュボード
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            バックエンドの ERROR/WARN ログをカテゴリ別に集計し、先週比の傾向を可視化します
          </p>
        </div>
      </div>

      <ErrorAnalyticsDashboard days={14} />
    </div>
  );
}

export default requireAuth(ErrorAnalyticsPage);
