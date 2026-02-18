/**
 * ログ解析結果のビジュアライザーコンポーネント
 */

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ResponsiveContainer
} from 'recharts';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  Activity,
  Search,
  Download,
  Clock,
  TrendingUp
} from 'lucide-react';

import type { LogAnalysisResult, LogLevel, ParsedLogEntry } from '@/types/debug-log';

interface LogAnalysisViewerProps {
  analysis: LogAnalysisResult;
  onExport?: () => void;
}

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '#9CA3AF',
  debug: '#6B7280',
  info: '#3B82F6',
  warn: '#F59E0B',
  error: '#EF4444',
  fatal: '#991B1B'
};

const LOG_LEVEL_ICONS: Record<LogLevel, React.ElementType> = {
  trace: Bug,
  debug: Bug,
  info: Info,
  warn: AlertTriangle,
  error: AlertCircle,
  fatal: AlertCircle
};

export const LogAnalysisViewer: React.FC<LogAnalysisViewerProps> = ({
  analysis,
  onExport
}) => {
  const [searchText, setSearchText] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | null>(null);
  const [selectedTab, setSelectedTab] = useState('overview');

  // ログエントリーのフィルタリング
  const filteredEntries = useMemo(() => {
    return analysis.entries.filter(entry => {
      if (selectedLevel && entry.level !== selectedLevel) return false;
      if (searchText && entry.message && !entry.message.toLowerCase().includes(searchText.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [analysis.entries, selectedLevel, searchText]);

  // レベル分布のチャートデータ
  const levelChartData = useMemo(() => {
    return Object.entries(analysis.summary.levelDistribution)
      .filter(([_, count]) => count > 0)
      .map(([level, count]) => ({
        level: level.toUpperCase(),
        count,
        color: LOG_LEVEL_COLORS[level as LogLevel]
      }));
  }, [analysis.summary.levelDistribution]);

  // タイムラインデータの生成
  const timelineData = useMemo(() => {
    if (!analysis.summary.timeRange) return [];

    const entriesWithTime = analysis.entries
      .filter(entry => entry.timestamp)
      .sort((a, b) => (a.timestamp!.getTime() - b.timestamp!.getTime()));

    // 時間ごとのエラー数を集計
    const hourlyData = new Map<string, { time: string, errors: number, warnings: number, info: number }>();

    entriesWithTime.forEach(entry => {
      const hour = entry.timestamp!.toISOString().substring(0, 13);
      const existing = hourlyData.get(hour) || { time: hour, errors: 0, warnings: 0, info: 0 };

      switch (entry.level) {
        case 'error':
        case 'fatal':
          existing.errors++;
          break;
        case 'warn':
          existing.warnings++;
          break;
        default:
          existing.info++;
      }

      hourlyData.set(hour, existing);
    });

    return Array.from(hourlyData.values());
  }, [analysis.entries, analysis.summary.timeRange]);

  // ソース分布のチャートデータ
  const sourceChartData = useMemo(() => {
    return Object.entries(analysis.summary.sourceDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([source, count]) => ({
        source,
        count
      }));
  }, [analysis.summary.sourceDistribution]);

  const renderLogEntry = (entry: ParsedLogEntry, index: number) => {
    const Icon = entry.level ? LOG_LEVEL_ICONS[entry.level] : Info;
    const color = entry.level ? LOG_LEVEL_COLORS[entry.level] : '#6B7280';

    return (
      <div
        key={index}
        className="flex items-start gap-3 p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/50"
      >
        <Icon className="w-4 h-4 mt-1 flex-shrink-0" style={{ color }} />
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
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">ログ解析結果</h2>
        {onExport && (
          <Button onClick={onExport} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            エクスポート
          </Button>
        )}
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">総エントリー数</p>
                <p className="text-2xl font-bold">{analysis.summary.totalEntries}</p>
              </div>
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>

        <Card className={analysis.summary.errorCount > 0 ? 'border-red-500' : ''}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">エラー数</p>
                <p className="text-2xl font-bold text-red-500">{analysis.summary.errorCount}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className={analysis.summary.warningCount > 0 ? 'border-yellow-500' : ''}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">警告数</p>
                <p className="text-2xl font-bold text-yellow-500">{analysis.summary.warningCount}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">時間範囲</p>
                <p className="text-sm font-medium">
                  {analysis.summary.timeRange
                    ? `${Math.round(
                        (analysis.summary.timeRange.end.getTime() -
                          analysis.summary.timeRange.start.getTime()) /
                          1000 / 60
                      )}分`
                    : 'N/A'}
                </p>
              </div>
              <Clock className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* タブ */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">概要</TabsTrigger>
          <TabsTrigger value="timeline">タイムライン</TabsTrigger>
          <TabsTrigger value="patterns">パターン</TabsTrigger>
          <TabsTrigger value="sources">ソース</TabsTrigger>
          <TabsTrigger value="logs">ログ詳細</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* レベル分布 */}
          <Card>
            <CardHeader>
              <CardTitle>ログレベル分布</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={levelChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ level, count }) => `${level}: ${count}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="count"
                  >
                    {levelChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ログタイムライン</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(time) => new Date(time).toLocaleString()}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="errors"
                    stroke="#EF4444"
                    name="エラー"
                  />
                  <Line
                    type="monotone"
                    dataKey="warnings"
                    stroke="#F59E0B"
                    name="警告"
                  />
                  <Line
                    type="monotone"
                    dataKey="info"
                    stroke="#3B82F6"
                    name="情報"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patterns" className="space-y-4">
          {/* エラーパターン */}
          {analysis.patterns.errors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>頻出エラーパターン</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.patterns.errors.slice(0, 5).map((pattern, index) => (
                    <div key={index} className="border-l-4 border-red-500 pl-4">
                      <div className="flex justify-between items-start">
                        <p className="text-sm font-mono text-gray-700 dark:text-gray-300">
                          {pattern.pattern}
                        </p>
                        <Badge variant="destructive">{pattern.count}回</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 警告パターン */}
          {analysis.patterns.warnings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>頻出警告パターン</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.patterns.warnings.slice(0, 5).map((pattern, index) => (
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

          {/* 頻出メッセージ */}
          <Card>
            <CardHeader>
              <CardTitle>頻出メッセージ</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.patterns.frequentMessages.slice(0, 10).map((pattern, index) => (
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

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>ソース別ログ数</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={sourceChartData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="source" type="category" width={150} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          {/* フィルター */}
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-4">
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="ログを検索..."
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  {Object.entries(LOG_LEVEL_COLORS).map(([level, color]) => (
                    <Button
                      key={level}
                      size="sm"
                      variant={selectedLevel === level ? 'default' : 'outline'}
                      onClick={() => setSelectedLevel(selectedLevel === level ? null : level as LogLevel)}
                      style={{
                        borderColor: selectedLevel === level ? color : undefined,
                        backgroundColor: selectedLevel === level ? color : undefined
                      }}
                    >
                      {level.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ログエントリー一覧 */}
          <Card>
            <CardHeader>
              <CardTitle>
                ログエントリー
                <span className="text-sm text-gray-500 ml-2">
                  ({filteredEntries.length} / {analysis.entries.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                {filteredEntries.slice(0, 1000).map((entry, index) => renderLogEntry(entry, index))}
                {filteredEntries.length > 1000 && (
                  <div className="p-4 text-center text-gray-500">
                    表示上限（1000件）を超えています。フィルターを使用して絞り込んでください。
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};