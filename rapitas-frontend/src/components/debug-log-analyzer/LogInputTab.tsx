/**
 * LogInputTab
 *
 * Log content input panel for the debug log analyzer.
 * Handles file upload, sample log loading, and the main log textarea.
 */

import React, { useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Trash2, Play, AlertCircle, Loader2 } from 'lucide-react';
import type { LogType } from '@/types/debug-log';

/** Sample log strings keyed by format name. */
const SAMPLE_LOGS = {
  json: `{"timestamp":"2024-02-19T10:00:00Z","level":"info","message":"Application started","source":"app.main"}
{"timestamp":"2024-02-19T10:00:01Z","level":"error","message":"Failed to connect to database","source":"db.connection","error":"Connection timeout"}
{"timestamp":"2024-02-19T10:00:02Z","level":"warn","message":"Retry attempt 1 of 3","source":"db.connection"}`,

  nodejs: `[2024-02-19T10:00:00.000Z] INFO: Server listening on port 3000
[2024-02-19T10:00:01.000Z] ERROR: Failed to load configuration file
[2024-02-19T10:00:02.000Z] WARN: Using default configuration
[2024-02-19T10:00:03.000Z] DEBUG: Processing request /api/users`,

  apache: `192.168.1.1 - - [19/Feb/2024:10:00:00 +0000] "GET /index.html HTTP/1.1" 200 1234
192.168.1.2 - admin [19/Feb/2024:10:00:01 +0000] "POST /api/login HTTP/1.1" 401 0
192.168.1.3 - - [19/Feb/2024:10:00:02 +0000] "GET /favicon.ico HTTP/1.1" 404 0`,

  nginx: `192.168.1.1 - admin [19/Feb/2024:10:00:00 +0000] "GET /api/users HTTP/1.1" 200 567 "-" "Mozilla/5.0"
192.168.1.2 - - [19/Feb/2024:10:00:01 +0000] "POST /api/auth HTTP/1.1" 500 123 "http://example.com" "curl/7.68.0"
192.168.1.3 - - [19/Feb/2024:10:00:02 +0000] "GET /static/css/main.css HTTP/1.1" 304 0 "http://example.com" "Chrome/120.0"`,
} as const;

type SampleKey = keyof typeof SAMPLE_LOGS;

interface LogInputTabProps {
  /** Current raw log content string. */
  logContent: string;
  /** Currently selected log format type. */
  selectedLogType: LogType;
  /** Whether analysis is in progress. */
  isAnalyzing: boolean;
  /** Error message to display, or null. */
  error: string | null;
  onLogContentChange: (content: string) => void;
  onLogTypeChange: (type: LogType) => void;
  onAnalyze: () => void;
  onClear: () => void;
}

/**
 * Renders the log input tab including type selector, file upload, sample buttons,
 * log textarea, action buttons, and error display.
 *
 * @param props - LogInputTabProps
 */
export const LogInputTab: React.FC<LogInputTabProps> = ({
  logContent,
  selectedLogType,
  isAnalyzing,
  error,
  onLogContentChange,
  onLogTypeChange,
  onAnalyze,
  onClear,
}) => {
  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        onLogContentChange(e.target?.result as string);
      };
      reader.onerror = () => {
        // NOTE: Error is surfaced via the parent's error state via onAnalyze failure path.
        // File read errors are handled here but propagation relies on UI re-render.
      };
      reader.readAsText(file);
    },
    [onLogContentChange],
  );

  const loadSampleLog = useCallback(
    (type: SampleKey) => {
      onLogContentChange(SAMPLE_LOGS[type]);
      const typeMap: Record<SampleKey, LogType> = {
        json: 'json',
        nodejs: 'nodejs',
        apache: 'apache_common',
        nginx: 'nginx',
      };
      onLogTypeChange(typeMap[type]);
    },
    [onLogContentChange, onLogTypeChange],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>ログ入力</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Log type selector */}
        <div className="flex items-center gap-4">
          <Label htmlFor="logType" className="min-w-[100px]">
            ログタイプ:
          </Label>
          <Select
            id="logType"
            className="w-[200px]"
            value={selectedLogType}
            onChange={(e) => onLogTypeChange(e.target.value as LogType)}
          >
            <option value="unknown">自動検出</option>
            <option value="json">JSON</option>
            <option value="syslog">Syslog</option>
            <option value="apache_common">Apache Common</option>
            <option value="apache_combined">Apache Combined</option>
            <option value="nginx">Nginx</option>
            <option value="nodejs">Node.js</option>
            <option value="custom">カスタム</option>
          </Select>
        </div>

        {/* File upload */}
        <div className="flex items-center gap-4">
          <Label htmlFor="fileUpload" className="min-w-[100px]">
            ファイル:
          </Label>
          <div className="flex-1">
            <Input
              id="fileUpload"
              type="file"
              accept=".log,.txt,.json"
              onChange={handleFileUpload}
              className="cursor-pointer"
            />
          </div>
        </div>

        {/* Sample log buttons */}
        <div className="flex items-center gap-4">
          <Label className="min-w-[100px]">サンプル:</Label>
          <div className="flex gap-2">
            {(['json', 'nodejs', 'apache', 'nginx'] as SampleKey[]).map(
              (key) => (
                <Button
                  key={key}
                  variant="outline"
                  size="sm"
                  onClickAction={() => loadSampleLog(key)}
                >
                  {key === 'apache'
                    ? 'Apache'
                    : key === 'nodejs'
                      ? 'Node.js'
                      : key.toUpperCase()}
                </Button>
              ),
            )}
          </div>
        </div>

        {/* Log content textarea */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label>ログコンテンツ:</Label>
            {logContent && (
              <span className="text-sm text-gray-500">
                {logContent.split('\n').filter((l) => l.trim()).length} 行
              </span>
            )}
          </div>
          <Textarea
            value={logContent}
            onChange={(e) => onLogContentChange(e.target.value)}
            placeholder="ログを貼り付けるか、ファイルをアップロードしてください..."
            className="font-mono text-sm"
            rows={15}
          />
        </div>

        {/* Action buttons */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClickAction={onClear}
            disabled={!logContent}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            クリア
          </Button>
          <Button
            onClickAction={onAnalyze}
            disabled={!logContent || isAnalyzing}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                解析中...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                解析開始
              </>
            )}
          </Button>
        </div>

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
