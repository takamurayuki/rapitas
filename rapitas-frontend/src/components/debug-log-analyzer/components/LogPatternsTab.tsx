/**
 * LogPatternsTab
 *
 * Tab panel for displaying repeated error patterns, warning patterns,
 * and frequently occurring log messages.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import type { LogAnalysisResult } from '@/types/debug-log';

interface LogPatternsTabProps {
  patterns: LogAnalysisResult['patterns'];
}

/**
 * Renders the patterns tab panel with error patterns, warning patterns, and frequent messages.
 *
 * @param patterns - Pattern analysis extracted from the log entries / ログエントリーから抽出されたパターン分析
 */
export const LogPatternsTab: React.FC<LogPatternsTabProps> = ({ patterns }) => {
  return (
    <TabsContent value="patterns" className="space-y-4">
      {/* Error patterns */}
      {patterns.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>頻出エラーパターン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {patterns.errors.slice(0, 5).map((pattern, index) => (
                <div key={index} className="border-l-4 border-red-500 pl-4">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-mono text-gray-700 dark:text-gray-300">
                      {pattern.pattern}
                    </p>
                    <Badge
                      variant="default"
                      className="bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100"
                    >
                      {pattern.count}回
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warning patterns */}
      {patterns.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>頻出警告パターン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {patterns.warnings.slice(0, 5).map((pattern, index) => (
                <div key={index} className="border-l-4 border-yellow-500 pl-4">
                  <div className="flex justify-between items-start">
                    <p className="text-sm font-mono text-gray-700 dark:text-gray-300">
                      {pattern.pattern}
                    </p>
                    <Badge className="bg-yellow-500">{pattern.count}回</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Frequent messages */}
      <Card>
        <CardHeader>
          <CardTitle>頻出メッセージ</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {patterns.frequentMessages.slice(0, 10).map((pattern, index) => (
              <div key={index} className="flex justify-between items-start">
                <p className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate flex-1">
                  {pattern.pattern}
                </p>
                <Badge variant="outline">{pattern.count}回</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
};
