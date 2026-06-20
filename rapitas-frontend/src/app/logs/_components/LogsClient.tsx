'use client';

/**
 * LogsClient
 *
 * Per-theme log-analysis dashboard. Lets the user pick a theme (one that has a
 * working directory), reads that theme's logs from disk (configured logDir →
 * working-directory scan), and feeds them to the format-flexible DebugLogAnalyzer.
 * Manual paste/upload still works via the analyzer's input tab.
 */
import { useEffect, useState, useCallback } from 'react';
import { ScrollText, FolderOpen, AlertCircle, RefreshCw } from 'lucide-react';
import { DebugLogAnalyzer } from '@/components/debug-log-analyzer';
import { useDebugLogAnalyzer } from '@/hooks/feature/useDebugLogAnalyzer';
import type { LogType, LogAnalysisResult } from '@/types/debug-log';
import { API_BASE_URL } from '@/utils/api';

interface LogTheme {
  id: number;
  name: string;
  workingDirectory: string;
  logDir: string | null;
  logFormat: 'pino' | 'json' | 'text' | null;
}

interface ThemeLogRead {
  content: string;
  source: 'configured' | 'scanned' | 'none';
  directory: string | null;
  files: string[];
  configuredFormat: 'pino' | 'json' | 'text' | null;
  truncated: boolean;
  note?: string;
}

/** Map the coarse per-theme format to a DebugLogAnalyzer type hint. */
function toLogType(fmt: ThemeLogRead['configuredFormat']): LogType {
  // pino/json are NDJSON-ish → 'json'; otherwise let the analyzer auto-detect.
  return fmt === 'pino' || fmt === 'json' ? 'json' : 'unknown';
}

const SOURCE_LABEL: Record<ThemeLogRead['source'], string> = {
  configured: '設定されたログディレクトリ',
  scanned: '作業ディレクトリから自動検出',
  none: 'ログ未検出',
};

export default function LogsClient() {
  const [themes, setThemes] = useState<LogTheme[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [read, setRead] = useState<ThemeLogRead | null>(null);
  const [readLoading, setReadLoading] = useState(false);
  const { analyzeLog } = useDebugLogAnalyzer();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/debug-logs/themes`);
        if (res.ok) {
          const data = (await res.json()) as { themes: LogTheme[] };
          setThemes(data.themes ?? []);
          if (data.themes?.length) setSelectedId(data.themes[0].id);
        }
      } finally {
        setThemesLoading(false);
      }
    })();
  }, []);

  const loadLogs = useCallback(async (themeId: number) => {
    setReadLoading(true);
    setRead(null);
    try {
      const res = await fetch(`${API_BASE_URL}/debug-logs/theme/${themeId}/read`);
      if (res.ok) setRead((await res.json()) as ThemeLogRead);
    } finally {
      setReadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId != null) void loadLogs(selectedId);
  }, [selectedId, loadLogs]);

  const onAnalyze = useCallback(
    async (content: string, type?: LogType): Promise<LogAnalysisResult> => {
      const result = await analyzeLog(content, type);
      if (!result) throw new Error('ログ分析に失敗しました');
      return result;
    },
    [analyzeLog],
  );

  if (themesLoading) {
    return <div className="p-6 text-sm text-zinc-500">読み込み中…</div>;
  }

  if (themes.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            作業ディレクトリが設定されたテーマがありません。テーマに作業ディレクトリを設定すると、
            そのテーマのログをここで分析できます。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-violet-500" />
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">ログ分析</h1>
      </div>

      {/* Theme switcher + source banner */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">テーマ</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => selectedId != null && loadLogs(selectedId)}
          disabled={readLoading}
          className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="再読み込み"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${readLoading ? 'animate-spin' : ''}`} />
          再読み込み
        </button>

        {read && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{SOURCE_LABEL[read.source]}:</span>
            <span className="truncate font-mono">{read.directory ?? '—'}</span>
            {read.truncated && <span className="shrink-0 text-amber-500">（一部のみ表示）</span>}
          </div>
        )}
      </div>

      {read?.note && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/40 dark:text-zinc-300">
          {read.note} 下の入力欄にログを貼り付けて分析することもできます。
        </div>
      )}

      {readLoading ? (
        <div className="p-6 text-sm text-zinc-500">ログを読み込み中…</div>
      ) : (
        // key={selectedId} resets the analyzer's state when the theme changes.
        <DebugLogAnalyzer
          key={selectedId ?? 'none'}
          onAnalyze={onAnalyze}
          initialContent={read?.content ?? ''}
          initialType={toLogType(read?.configuredFormat ?? null)}
        />
      )}
    </div>
  );
}
