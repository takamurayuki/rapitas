/**
 * デバッグログ解析ツールのメインコンポーネント
 */

import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  FileText,
  Trash2,
  Play,
  Download,
  FileCode,
  Settings,
  AlertCircle,
  CheckCircle,
  Loader2
} from 'lucide-react';
import { LogAnalysisViewer } from './LogAnalysisViewer';
import type { LogType, LogAnalysisResult, LogFilter, LogLevel } from '@/types/debug-log';

interface DebugLogAnalyzerProps {
  onAnalyze?: (logContent: string, logType?: LogType) => Promise<LogAnalysisResult>;
}

export const DebugLogAnalyzer: React.FC<DebugLogAnalyzerProps> = ({ onAnalyze }) => {
  const [logContent, setLogContent] = useState('');
  const [selectedLogType, setSelectedLogType] = useState<LogType>('unknown');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<LogAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState('input');

  // フィルター設定
  const [filter, setFilter] = useState<LogFilter>({});

  // サンプルログ
  const sampleLogs = {
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
192.168.1.3 - - [19/Feb/2024:10:00:02 +0000] "GET /static/css/main.css HTTP/1.1" 304 0 "http://example.com" "Chrome/120.0"`
  };

  // ファイルアップロード処理
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setLogContent(content);
      setError(null);
    };
    reader.onerror = () => {
      setError('ファイルの読み込みに失敗しました');
    };
    reader.readAsText(file);
  }, []);

  // サンプルログの読み込み
  const loadSampleLog = useCallback((type: keyof typeof sampleLogs) => {
    setLogContent(sampleLogs[type]);
    setSelectedLogType(type === 'json' ? 'json' :
                      type === 'nodejs' ? 'nodejs' :
                      type === 'apache' ? 'apache_common' :
                      type === 'nginx' ? 'nginx' : 'unknown');
    setError(null);
  }, []);

  // ログ解析の実行
  const handleAnalyze = useCallback(async () => {
    if (!logContent.trim()) {
      setError('ログコンテンツを入力してください');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      let result: LogAnalysisResult;

      if (onAnalyze) {
        result = await onAnalyze(logContent, selectedLogType);
      } else {
        // デモ用のダミー解析結果
        const lines = logContent.split('\n').filter(line => line.trim());
        const now = new Date();

        result = {
          entries: lines.map((line, index) => ({
            raw: line,
            type: selectedLogType,
            message: line,
            timestamp: new Date(now.getTime() - (lines.length - index) * 1000),
            level: line.toLowerCase().includes('error') ? 'error' as LogLevel :
                   line.toLowerCase().includes('warn') ? 'warn' as LogLevel :
                   line.toLowerCase().includes('debug') ? 'debug' as LogLevel :
                   'info' as LogLevel
          })),
          summary: {
            totalEntries: lines.length,
            errorCount: lines.filter(l => l.toLowerCase().includes('error')).length,
            warningCount: lines.filter(l => l.toLowerCase().includes('warn')).length,
            timeRange: {
              start: new Date(now.getTime() - lines.length * 1000),
              end: now
            },
            levelDistribution: {
              trace: 0,
              debug: lines.filter(l => l.toLowerCase().includes('debug')).length,
              info: lines.filter(l => !l.toLowerCase().includes('error') && !l.toLowerCase().includes('warn') && !l.toLowerCase().includes('debug')).length,
              warn: lines.filter(l => l.toLowerCase().includes('warn')).length,
              error: lines.filter(l => l.toLowerCase().includes('error')).length,
              fatal: 0
            },
            sourceDistribution: {}
          },
          patterns: {
            errors: [],
            warnings: [],
            frequentMessages: []
          }
        };
      }

      setAnalysisResult(result);
      setSelectedTab('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析中にエラーが発生しました');
    } finally {
      setIsAnalyzing(false);
    }
  }, [logContent, selectedLogType, onAnalyze]);

  // 結果のエクスポート
  const handleExport = useCallback(() => {
    if (!analysisResult) return;

    const exportData = {
      ...analysisResult,
      exportDate: new Date().toISOString(),
      filters: filter
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-analysis-${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analysisResult, filter]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">デバッグログ解析ツール</h1>
        <Badge variant="outline" className="text-sm">
          <FileCode className="w-4 h-4 mr-1" />
          対応形式: JSON, Syslog, Apache, Nginx, Node.js
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList>
          <TabsTrigger value="input">ログ入力</TabsTrigger>
          <TabsTrigger value="result" disabled={!analysisResult}>
            解析結果
          </TabsTrigger>
          <TabsTrigger value="settings">設定</TabsTrigger>
        </TabsList>

        <TabsContent value="input" className="space-y-4">
          {/* ログ入力エリア */}
          <Card>
            <CardHeader>
              <CardTitle>ログ入力</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* ログタイプ選択 */}
              <div className="flex items-center gap-4">
                <Label htmlFor="logType" className="min-w-[100px]">ログタイプ:</Label>
                <Select
                  id="logType"
                  className="w-[200px]"
                  value={selectedLogType}
                  onChange={(e) => setSelectedLogType(e.target.value as LogType)}
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

              {/* ファイルアップロード */}
              <div className="flex items-center gap-4">
                <Label htmlFor="fileUpload" className="min-w-[100px]">ファイル:</Label>
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

              {/* サンプルログボタン */}
              <div className="flex items-center gap-4">
                <Label className="min-w-[100px]">サンプル:</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSampleLog('json')}
                  >
                    JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSampleLog('nodejs')}
                  >
                    Node.js
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSampleLog('apache')}
                  >
                    Apache
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadSampleLog('nginx')}
                  >
                    Nginx
                  </Button>
                </div>
              </div>

              {/* ログコンテンツ */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label>ログコンテンツ:</Label>
                  {logContent && (
                    <span className="text-sm text-gray-500">
                      {logContent.split('\n').filter(l => l.trim()).length} 行
                    </span>
                  )}
                </div>
                <Textarea
                  value={logContent}
                  onChange={(e) => setLogContent(e.target.value)}
                  placeholder="ログを貼り付けるか、ファイルをアップロードしてください..."
                  className="font-mono text-sm"
                  rows={15}
                />
              </div>

              {/* アクションボタン */}
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    setLogContent('');
                    setError(null);
                    setAnalysisResult(null);
                  }}
                  disabled={!logContent}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  クリア
                </Button>
                <Button
                  onClick={handleAnalyze}
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

              {/* エラー表示 */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="result">
          {analysisResult && (
            <LogAnalysisViewer
              analysis={analysisResult}
              onExport={handleExport}
            />
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
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
                    onChange={(e) => setFilter({ ...filter, level: e.target.value as LogLevel || undefined })}
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
                    onChange={(e) => setFilter({ ...filter, source: e.target.value || undefined })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>開始時刻</Label>
                  <Input
                    type="datetime-local"
                    value={filter.startTime ? filter.startTime.toISOString().slice(0, 16) : ''}
                    onChange={(e) => setFilter({
                      ...filter,
                      startTime: e.target.value ? new Date(e.target.value) : undefined
                    })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>終了時刻</Label>
                  <Input
                    type="datetime-local"
                    value={filter.endTime ? filter.endTime.toISOString().slice(0, 16) : ''}
                    onChange={(e) => setFilter({
                      ...filter,
                      endTime: e.target.value ? new Date(e.target.value) : undefined
                    })}
                  />
                </div>

                <div className="col-span-2 space-y-2">
                  <Label>テキスト検索</Label>
                  <Input
                    placeholder="検索キーワード..."
                    value={filter.searchText || ''}
                    onChange={(e) => setFilter({ ...filter, searchText: e.target.value || undefined })}
                  />
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => setFilter({})}
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
        </TabsContent>
      </Tabs>
    </div>
  );
};