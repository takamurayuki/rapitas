/**
 * DebugLogAnalyzer
 *
 * Main component for the debug log analysis tool.
 * Orchestrates state, delegates rendering to LogInputTab, LogSettingsTab,
 * and LogAnalysisViewer. Does not contain parsing logic itself.
 */

import React, { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileCode } from 'lucide-react';
import { LogAnalysisViewer } from './LogAnalysisViewer';
import { LogInputTab } from './LogInputTab';
import { LogSettingsTab } from './LogSettingsTab';
import type { LogType, LogAnalysisResult, LogFilter, LogLevel } from '@/types/debug-log';

interface DebugLogAnalyzerProps {
  onAnalyze?: (logContent: string, logType?: LogType) => Promise<LogAnalysisResult>;
  /** Pre-fill the log input (e.g. logs read from a theme). Pass a changing `key`
   *  to reset when the source changes. / 入力の初期値（テーマのログ等） */
  initialContent?: string;
  /** Pre-select the log type. / ログ形式の初期選択 */
  initialType?: LogType;
}

/**
 * Builds a dummy analysis result for demo purposes when no onAnalyze prop is provided.
 *
 * @param logContent - Raw log text / 生のログテキスト
 * @param selectedLogType - Detected or selected log format / ログ形式
 * @returns A synthetic LogAnalysisResult
 */
function buildDemoResult(logContent: string, selectedLogType: LogType): LogAnalysisResult {
  const lines = logContent.split('\n').filter((line) => line.trim());
  const now = new Date();

  return {
    entries: lines.map((line, index) => ({
      raw: line,
      type: selectedLogType,
      message: line,
      timestamp: new Date(now.getTime() - (lines.length - index) * 1000),
      level: line.toLowerCase().includes('error')
        ? ('error' as LogLevel)
        : line.toLowerCase().includes('warn')
          ? ('warn' as LogLevel)
          : line.toLowerCase().includes('debug')
            ? ('debug' as LogLevel)
            : ('info' as LogLevel),
    })),
    summary: {
      totalEntries: lines.length,
      errorCount: lines.filter((l) => l.toLowerCase().includes('error')).length,
      warningCount: lines.filter((l) => l.toLowerCase().includes('warn')).length,
      timeRange: {
        start: new Date(now.getTime() - lines.length * 1000),
        end: now,
      },
      levelDistribution: {
        trace: 0,
        debug: lines.filter((l) => l.toLowerCase().includes('debug')).length,
        info: lines.filter(
          (l) =>
            !l.toLowerCase().includes('error') &&
            !l.toLowerCase().includes('warn') &&
            !l.toLowerCase().includes('debug'),
        ).length,
        warn: lines.filter((l) => l.toLowerCase().includes('warn')).length,
        error: lines.filter((l) => l.toLowerCase().includes('error')).length,
        fatal: 0,
      },
      sourceDistribution: {},
    },
    patterns: {
      errors: [],
      warnings: [],
      frequentMessages: [],
    },
  };
}

export const DebugLogAnalyzer: React.FC<DebugLogAnalyzerProps> = ({
  onAnalyze,
  initialContent = '',
  initialType = 'unknown',
}) => {
  const [logContent, setLogContent] = useState(initialContent);
  const [selectedLogType, setSelectedLogType] = useState<LogType>(initialType);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<LogAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState('input');
  const [filter, setFilter] = useState<LogFilter>({});
  const t = useTranslations('devTools');

  const handleAnalyze = useCallback(async () => {
    if (!logContent.trim()) {
      setError(t('debugLogAnalyzer.errors.emptyContent'));
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const result = onAnalyze
        ? await onAnalyze(logContent, selectedLogType)
        : buildDemoResult(logContent, selectedLogType);

      setAnalysisResult(result);
      setSelectedTab('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('debugLogAnalyzer.errors.analysisFailed'));
    } finally {
      setIsAnalyzing(false);
    }
  }, [logContent, selectedLogType, onAnalyze, t]);

  const handleExport = useCallback(() => {
    if (!analysisResult) return;

    const exportData = {
      ...analysisResult,
      exportDate: new Date().toISOString(),
      filters: filter,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-analysis-${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analysisResult, filter]);

  const handleClear = useCallback(() => {
    setLogContent('');
    setError(null);
    setAnalysisResult(null);
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">{t('debugLogAnalyzer.title')}</h1>
        <Badge variant="outline" className="text-sm">
          <FileCode className="w-4 h-4 mr-1" />
          {t('debugLogAnalyzer.supportedFormats')}
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="input">{t('debugLogAnalyzer.tabs.input')}</TabsTrigger>
          <TabsTrigger value="result" disabled={!analysisResult}>
            {t('debugLogAnalyzer.tabs.result')}
          </TabsTrigger>
          <TabsTrigger value="settings">{t('debugLogAnalyzer.tabs.settings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="input" className="space-y-4">
          <LogInputTab
            logContent={logContent}
            selectedLogType={selectedLogType}
            isAnalyzing={isAnalyzing}
            error={error}
            onLogContentChange={setLogContent}
            onLogTypeChange={setSelectedLogType}
            onAnalyze={handleAnalyze}
            onClear={handleClear}
          />
        </TabsContent>

        <TabsContent value="result">
          {analysisResult && (
            <LogAnalysisViewer analysis={analysisResult} onExport={handleExport} />
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <LogSettingsTab filter={filter} onFilterChange={setFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
