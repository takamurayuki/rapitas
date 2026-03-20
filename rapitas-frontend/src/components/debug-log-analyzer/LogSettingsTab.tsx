/**
 * LogSettingsTab
 *
 * Filter and custom parser configuration panel for the debug log analyzer.
 * Does not perform filtering itself; exposes filter state via callbacks.
 */

import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { LogFilter, LogLevel } from '@/types/debug-log';

interface LogSettingsTabProps {
  /** Current filter state. */
  filter: LogFilter;
  /**
   * Called whenever the filter changes.
   *
   * @param filter - Updated filter / フィルターの更新値
   */
  onFilterChange: (filter: LogFilter) => void;
}

/**
 * Renders the settings tab with level, source, time-range, and text-search filters.
 *
 * @param props - LogSettingsTabProps
 */
export const LogSettingsTab: React.FC<LogSettingsTabProps> = ({
  filter,
  onFilterChange,
}) => {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>フィルター設定</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>最小ログレベル</Label>
              <Select
                value={filter.level || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filter,
                    level: (e.target.value as LogLevel) || undefined,
                  })
                }
              >
                <option value="">すべて</option>
                <option value="trace">TRACE</option>
                <option value="debug">DEBUG</option>
                <option value="info">INFO</option>
                <option value="warn">WARN</option>
                <option value="error">ERROR</option>
                <option value="fatal">FATAL</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>ソースフィルター</Label>
              <Input
                placeholder="例: app.main"
                value={filter.source || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filter,
                    source: e.target.value || undefined,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>開始時刻</Label>
              <Input
                type="datetime-local"
                value={
                  filter.startTime
                    ? filter.startTime.toISOString().slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  onFilterChange({
                    ...filter,
                    startTime: e.target.value
                      ? new Date(e.target.value)
                      : undefined,
                  })
                }
              />
            </div>

            <div className="space-y-2">
              <Label>終了時刻</Label>
              <Input
                type="datetime-local"
                value={
                  filter.endTime
                    ? filter.endTime.toISOString().slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  onFilterChange({
                    ...filter,
                    endTime: e.target.value
                      ? new Date(e.target.value)
                      : undefined,
                  })
                }
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label>テキスト検索</Label>
              <Input
                placeholder="検索キーワード..."
                value={filter.searchText || ''}
                onChange={(e) =>
                  onFilterChange({
                    ...filter,
                    searchText: e.target.value || undefined,
                  })
                }
              />
            </div>
          </div>

          <Button
            variant="outline"
            onClickAction={() => onFilterChange({})}
            disabled={Object.keys(filter).length === 0}
          >
            フィルターをクリア
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>カスタムパーサー設定</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertDescription>
              カスタムパーサーの設定は、APIエンドポイント経由で設定可能です。
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
};
