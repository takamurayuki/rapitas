'use client';
/**
 * BackupCard
 *
 * Displays the last backup status, the list of recent encrypted archives,
 * and a "Run now" button that triggers POST /system/backups/run.
 */
import { useCallback, useEffect, useState } from 'react';
import { Database, Download, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface BackupItem {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  provider: string;
}

interface StatusBlock {
  lastRunAt: string | null;
  lastResult: 'success' | 'failed' | null;
  lastFilename: string | null;
  lastError: string | null;
}

interface ListResponse {
  backups: BackupItem[];
  status: StatusBlock;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '未実行';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'たった今';
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

export default function BackupCard() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/system/backups`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runNow = async () => {
    setRunning(true);
    try {
      await fetch(`${API_BASE_URL}/system/backups/run`, { method: 'POST' });
      await refresh();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-emerald-500" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            データベース バックアップ
          </h2>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          {running ? 'バックアップ中…' : '今すぐバックアップ'}
        </button>
      </div>

      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        週1回 自動的に暗号化アーカイブを <code className="font-mono">~/.rapitas/backups/</code>{' '}
        に作成します。直近 8 件保持。
      </p>

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-500">{error}</div>
      ) : !data ? null : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
            {data.status.lastResult === 'success' ? (
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            ) : data.status.lastResult === 'failed' ? (
              <AlertTriangle className="h-4 w-4 text-red-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-zinc-400" />
            )}
            <span className="text-xs text-zinc-700 dark:text-zinc-300">
              {data.status.lastResult === 'success'
                ? `最後のバックアップ: ${formatRelative(data.status.lastRunAt)}`
                : data.status.lastResult === 'failed'
                  ? `直近の実行は失敗: ${data.status.lastError ?? ''}`
                  : 'まだバックアップが実行されていません'}
            </span>
          </div>

          {data.backups.length === 0 ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              アーカイブはまだありません。
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.backups.map((b) => (
                <li key={b.filename} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="truncate font-mono text-zinc-700 dark:text-zinc-300">
                    {b.filename}
                  </span>
                  <span className="ml-2 shrink-0 text-zinc-500 dark:text-zinc-400">
                    {formatSize(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString('ja-JP')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
