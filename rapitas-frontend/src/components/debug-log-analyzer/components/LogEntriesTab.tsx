/**
 * LogEntriesTab
 *
 * Tab panel for browsing raw log entries with level filter buttons and a text search input.
 * Renders up to 1000 entries to avoid DOM overload on large logs.
 */

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Search,
} from 'lucide-react';
import type { LogAnalysisResult, LogLevel, ParsedLogEntry } from '@/types/debug-log';

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '#9CA3AF',
  debug: '#6B7280',
  info: '#3B82F6',
  warn: '#F59E0B',
  error: '#EF4444',
  fatal: '#991B1B',
};

const LOG_LEVEL_ICONS: Record<LogLevel, React.ElementType> = {
  trace: Bug,
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
  fatal: AlertCircle,
};

interface LogEntriesTabProps {
  entries: LogAnalysisResult['entries'];
}

/**
 * Renders the log-detail tab panel with search and level-filter controls.
 *
 * @param entries - All parsed log entries from the analysis result / 解析結果からのすべてのログエントリー
 */
export const LogEntriesTab: React.FC<LogEntriesTabProps> = ({ entries }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | null>(null);

  const filteredEntries = useMemo(
    () =>
      entries.filter((entry) => {
        if (selectedLevel && entry.level !== selectedLevel) return false;
        if (
          searchText &&
          entry.message &&
          !entry.message.toLowerCase().includes(searchText.toLowerCase())
        ) {
          return false;
        }
        return true;
      }),
    [entries, selectedLevel, searchText],
  );

  const renderLogEntry = (entry: ParsedLogEntry, index: number) => {
    const Icon = entry.level ? LOG_LEVEL_ICONS[entry.level] : Info;
    const color = entry.level ? LOG_LEVEL_COLORS[entry.level] : '#6B7280';

    return (
      <div
        key={index}
        className="flex items-start gap-3 p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50"
      >
        <Icon className="w-4 h-4 mt-1 shrink-0" style={{ color }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {entry.timestamp && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {entry.timestamp.toLocaleString()}
              </span>
            )}
            {entry.source && (
              <Badge variant="outline" className="text-xs">
                {entry.source}
              </Badge>
            )}
            {entry.level && (
              <Badge
                variant="outline"
                className="text-xs"
                style={{ borderColor: color, color }}
              >
                {entry.level.toUpperCase()}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 break-all">
            {entry.message || entry.raw}
          </p>
        </div>
      </div>
    );
  };

  return (
    <TabsContent value="logs" className="space-y-4">
      {/* Search and level filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="ログを検索..."
                  value={searchText}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setSearchText(e.target.value)
                  }
                  className="pl-10"
                />
              </div>
            </div>
            <div className="flex gap-2">
              {Object.entries(LOG_LEVEL_COLORS).map(([level]) => (
                <Button
                  key={level}
                  size="sm"
                  variant={selectedLevel === level ? 'secondary' : 'outline'}
                  onClickAction={() =>
                    setSelectedLevel(
                      selectedLevel === level ? null : (level as LogLevel),
                    )
                  }
                >
                  {level.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Log entries list — capped at 1000 to prevent DOM overload */}
      <Card>
        <CardHeader>
          <CardTitle>
            ログエントリー
            <span className="text-sm text-gray-500 ml-2">
              ({filteredEntries.length} / {entries.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            {filteredEntries.slice(0, 1000).map((entry, index) =>
              renderLogEntry(entry, index),
            )}
            {filteredEntries.length > 1000 && (
              <div className="p-4 text-center text-gray-500">
                表示上限（1000件）を超えています。フィルターを使用して絞り込んでください。
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </TabsContent>
  );
};
