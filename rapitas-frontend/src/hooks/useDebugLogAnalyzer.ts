/**
 * デバッグログ解析ツールを使うためのReact Hook
 */

import { useState, useCallback } from 'react';
import {
  LogType,
  LogAnalysisResult,
  AnalyzeOptions,
  AnalyzeLogRequest,
  AnalyzeLogResponse
} from '@/types/debug-log';

interface UseDebugLogAnalyzerResult {
  isAnalyzing: boolean;
  error: string | null;
  analyzeLog: (content: string, type?: LogType, options?: AnalyzeOptions) => Promise<LogAnalysisResult | null>;
  detectLogType: (content: string) => Promise<LogType>;
  getSupportedTypes: () => Promise<LogTypeInfo[]>;
  analyzeFromUrl: (url: string, type?: LogType, options?: AnalyzeOptions) => Promise<LogAnalysisResult | null>;
}

interface LogTypeInfo {
  id: string;
  name: string;
  description: string;
  example: string;
}

export function useDebugLogAnalyzer(): UseDebugLogAnalyzerResult {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  // ログを解析
  const analyzeLog = useCallback(
    async (
      content: string,
      type?: LogType,
      options?: AnalyzeOptions
    ): Promise<LogAnalysisResult | null> => {
      setIsAnalyzing(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/debug-logs/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
            type,
            options: options ? {
              ...options,
              filter: options.filter ? {
                ...options.filter,
                startTime: options.filter.startTime?.toISOString(),
                endTime: options.filter.endTime?.toISOString(),
              } : undefined
            } : undefined
          } as AnalyzeLogRequest),
        });

        const data: AnalyzeLogResponse = await response.json();

        if (!data.success || !data.result) {
          throw new Error(data.error || 'ログ解析に失敗しました');
        }

        // 日付文字列をDateオブジェクトに変換
        const result = {
          ...data.result,
          entries: data.result.entries.map(entry => ({
            ...entry,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
          })),
          summary: {
            ...data.result.summary,
            timeRange: data.result.summary.timeRange ? {
              start: new Date(data.result.summary.timeRange.start),
              end: new Date(data.result.summary.timeRange.end),
            } : undefined,
          },
        };

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'ログ解析中にエラーが発生しました';
        setError(message);
        console.error('Log analysis error:', err);
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [API_BASE_URL]
  );

  // ログタイプを検出
  const detectLogType = useCallback(async (content: string): Promise<LogType> => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug-logs/detect-type`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'タイプ検出に失敗しました');
      }

      return data.type as LogType;
    } catch (err) {
      console.error('Type detection error:', err);
      return 'unknown';
    }
  }, [API_BASE_URL]);

  // サポートされているログタイプを取得
  const getSupportedTypes = useCallback(async (): Promise<LogTypeInfo[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/debug-logs/supported-types`);
      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'タイプ一覧の取得に失敗しました');
      }

      return data.types;
    } catch (err) {
      console.error('Get supported types error:', err);
      return [];
    }
  }, [API_BASE_URL]);

  // URLからログを解析（大きなファイル用）
  const analyzeFromUrl = useCallback(
    async (
      url: string,
      type?: LogType,
      options?: AnalyzeOptions
    ): Promise<LogAnalysisResult | null> => {
      setIsAnalyzing(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/debug-logs/analyze-stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            type,
            options: options ? {
              ...options,
              filter: options.filter ? {
                ...options.filter,
                startTime: options.filter.startTime?.toISOString(),
                endTime: options.filter.endTime?.toISOString(),
              } : undefined
            } : undefined
          }),
        });

        const data = await response.json();

        if (!data.success || !data.result) {
          throw new Error(data.error || 'ストリーム解析に失敗しました');
        }

        // 日付文字列をDateオブジェクトに変換
        const result = {
          ...data.result,
          entries: data.result.entries.map((entry: ParsedLogEntry) => ({
            ...entry,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : undefined,
          })),
          summary: {
            ...data.result.summary,
            timeRange: data.result.summary.timeRange ? {
              start: new Date(data.result.summary.timeRange.start),
              end: new Date(data.result.summary.timeRange.end),
            } : undefined,
          },
        };

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'ストリーム解析中にエラーが発生しました';
        setError(message);
        console.error('Stream analysis error:', err);
        return null;
      } finally {
        setIsAnalyzing(false);
      }
    },
    [API_BASE_URL]
  );

  return {
    isAnalyzing,
    error,
    analyzeLog,
    detectLogType,
    getSupportedTypes,
    analyzeFromUrl,
  };
}