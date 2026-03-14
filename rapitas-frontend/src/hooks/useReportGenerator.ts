/**
 * レポート生成用のカスタムフック
 * 週次・月次レポートの生成とキャッシュ管理
 */

import { useState, useCallback, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useReportGenerator');

interface ReportData {
  weekStart: string;
  weekEnd: string;
  stats: {
    totalTasks: number;
    completedTasks: number;
    completionRate: number;
    averageCompletionDays: number;
  };
  trends: { date: string; tasksCompleted: number; hoursWorked: number }[];
  topCategories: { name: string; count: number }[];
  generatedAt: string;
}

type ReportType = 'weekly' | 'monthly';

interface UseReportGeneratorReturn {
  generateReport: (type?: ReportType) => Promise<void>;
  isGenerating: boolean;
  lastReport: ReportData | null;
  error: string | null;
  clearReport: () => void;
}

export function useReportGenerator(): UseReportGeneratorReturn {
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastReport, setLastReport] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generateReport = useCallback(async (type: ReportType = 'weekly') => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    abortRef.current = new AbortController();

    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch(`/api/analytics/reports/${type}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`レポートの生成に失敗しました (${res.status})`);
      }

      const data: ReportData = await res.json();
      setLastReport({ ...data, generatedAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const message =
        err instanceof Error
          ? err.message
          : 'レポート生成中にエラーが発生しました';
      logger.error('Report generation failed:', err);
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const clearReport = useCallback(() => {
    setLastReport(null);
    setError(null);
  }, []);

  return { generateReport, isGenerating, lastReport, error, clearReport };
}
