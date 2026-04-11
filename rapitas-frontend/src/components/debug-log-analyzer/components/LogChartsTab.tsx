/**
 * LogChartsTab
 *
 * Tab panels for the visual chart views of log analysis:
 * overview (pie chart by level), timeline (line chart by hour), and source bar chart.
 */

import React, { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
  ResponsiveContainer,
} from 'recharts';
import { TabsContent } from '@/components/ui/tabs';
import type { LogAnalysisResult, LogLevel } from '@/types/debug-log';

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '#9CA3AF',
  debug: '#6B7280',
  info: '#3B82F6',
  warn: '#F59E0B',
  error: '#EF4444',
  fatal: '#991B1B',
};

interface LogChartsTabProps {
  analysis: LogAnalysisResult;
}

/**
 * Renders the overview, timeline, and sources tab panels with recharts visualisations.
 *
 * @param analysis - Full log analysis result object / ログ解析結果全体
 */
export const LogChartsTab: React.FC<LogChartsTabProps> = ({ analysis }) => {
  const levelChartData = useMemo(
    () =>
      Object.entries(analysis.summary.levelDistribution)
        .filter(([, count]) => count > 0)
        .map(([level, count]) => ({
          level: level.toUpperCase(),
          count,
          color: LOG_LEVEL_COLORS[level as LogLevel],
        })),
    [analysis.summary.levelDistribution],
  );

  const timelineData = useMemo(() => {
    if (!analysis.summary.timeRange) return [];

    const entriesWithTime = analysis.entries
      .filter((entry) => entry.timestamp)
      .sort((a, b) => a.timestamp!.getTime() - b.timestamp!.getTime());

    // Aggregate error/warning/info counts per hour
    const hourlyData = new Map<
      string,
      { time: string; errors: number; warnings: number; info: number }
    >();

    entriesWithTime.forEach((entry) => {
      const hour = entry.timestamp!.toISOString().substring(0, 13);
      const existing = hourlyData.get(hour) || {
        time: hour,
        errors: 0,
        warnings: 0,
        info: 0,
      };

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

  const sourceChartData = useMemo(
    () =>
      Object.entries(analysis.summary.sourceDistribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([source, count]) => ({ source, count })),
    [analysis.summary.sourceDistribution],
  );

  return (
    <>
      {/* Overview tab — pie chart */}
      <TabsContent value="overview" className="space-y-4">
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
                  label={({ payload, value }) => `${payload.level}: ${value}`}
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

      {/* Timeline tab — line chart per hour */}
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
                  tickFormatter={(time: string | number) =>
                    new Date(time).toLocaleTimeString()
                  }
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(label) => {
                    if (
                      typeof label === 'string' ||
                      typeof label === 'number'
                    ) {
                      return new Date(label).toLocaleString();
                    }
                    return String(label);
                  }}
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

      {/* Sources tab — horizontal bar chart */}
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
    </>
  );
};
