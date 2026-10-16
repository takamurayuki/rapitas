/**
 * LogAnalysisViewer
 *
 * Visualizer component for log analysis results.
 * Composes LogSummaryCards, LogChartsTab, LogPatternsTab, and LogEntriesTab
 * into a tabbed layout. Does not own analysis state — receives it as a prop.
 */

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download } from 'lucide-react';
import type { LogAnalysisResult } from '@/types/debug-log';
import { LogSummaryCards } from './components/LogSummaryCards';
import { LogChartsTab } from './components/LogChartsTab';
import { LogPatternsTab } from './components/LogPatternsTab';
import { LogEntriesTab } from './components/LogEntriesTab';

interface LogAnalysisViewerProps {
  analysis: LogAnalysisResult;
  onExport?: () => void;
}

/**
 * Top-level viewer for a completed log analysis result.
 *
 * @param analysis - The full log analysis result to display / 表示するログ解析結果
 * @param onExport - Optional callback invoked when the user clicks export / エクスポートボタン押下時のコールバック（省略可）
 */
export const LogAnalysisViewer: React.FC<LogAnalysisViewerProps> = ({ analysis, onExport }) => {
  const [selectedTab, setSelectedTab] = useState('overview');
  const t = useTranslations('devTools');
  const tCommon = useTranslations('common');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{t('debugLogAnalyzer.viewer.title')}</h2>
        {onExport && (
          <Button onClickAction={onExport} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            {tCommon('export')}
          </Button>
        )}
      </div>

      <LogSummaryCards summary={analysis.summary} />

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">{t('debugLogAnalyzer.viewer.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="timeline">{t('debugLogAnalyzer.viewer.tabs.timeline')}</TabsTrigger>
          <TabsTrigger value="patterns">{t('debugLogAnalyzer.viewer.tabs.patterns')}</TabsTrigger>
          <TabsTrigger value="sources">{t('debugLogAnalyzer.viewer.tabs.sources')}</TabsTrigger>
          <TabsTrigger value="logs">{t('debugLogAnalyzer.viewer.tabs.logs')}</TabsTrigger>
        </TabsList>

        <LogChartsTab analysis={analysis} />
        <LogPatternsTab patterns={analysis.patterns} />
        <LogEntriesTab entries={analysis.entries} />
      </Tabs>
    </div>
  );
};
