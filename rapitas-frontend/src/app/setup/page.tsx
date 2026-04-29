'use client';
/**
 * Setup Wizard
 *
 * First-run flow that confirms the database is reachable and at least one
 * AI provider is usable. Works for both deployment shapes:
 *   - Tauri desktop (SQLite, single user)
 *   - Web/server  (PostgreSQL)
 *
 * The wizard is also reachable from Settings whenever the user wants to
 * recheck their environment.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle,
  XCircle,
  Loader2,
  Database,
  Sparkles,
  HardDrive,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

type DbProvider = 'sqlite' | 'postgresql' | 'unknown';

interface DbStatus {
  provider: DbProvider;
  connected: boolean;
  detail: string;
  filePath?: string;
  fileSizeBytes?: number;
}

interface ProviderStatus {
  provider: 'claude' | 'chatgpt' | 'gemini' | 'ollama';
  available: boolean;
  reason: string | null;
  modelCount: number;
}

interface SetupStatus {
  database: DbStatus;
  providers: ProviderStatus[];
  setupComplete: boolean;
  env: { nodeEnv?: string; tauriBuild?: boolean };
}

const PROVIDER_LABEL: Record<ProviderStatus['provider'], string> = {
  claude: 'Claude Code CLI',
  chatgpt: 'Codex CLI',
  gemini: 'Gemini CLI',
  ollama: 'Ollama (ローカルLLM)',
};

function formatBytes(n?: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SetupWizardPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/system/setup/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus((await res.json()) as SetupStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Persist completion so layout-level redirect can short-circuit on next launch.
  useEffect(() => {
    if (status?.setupComplete) {
      try {
        localStorage.setItem('rapitas:setup-completed', 'true');
      } catch {
        /* ignore — not fatal */
      }
    }
  }, [status?.setupComplete]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
              初回セットアップ
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              データベース接続と AI プロバイダーの状態を確認します。
            </p>
          </div>
          <button
            onClick={fetchStatus}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            再チェック
          </button>
        </header>

        {error ? (
          <ErrorPanel message={error} onRetry={fetchStatus} />
        ) : !status ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
          </div>
        ) : (
          <div className="space-y-4">
            <Step
              index={1}
              title="データベース"
              icon={<Database className="h-5 w-5" />}
              ok={status.database.connected}
            >
              <DbDetail db={status.database} />
            </Step>

            <Step
              index={2}
              title="AI プロバイダー"
              icon={<Sparkles className="h-5 w-5" />}
              ok={status.providers.some((p) => p.available)}
            >
              <ProviderList providers={status.providers} />
            </Step>

            <Step
              index={3}
              title="準備完了"
              icon={<HardDrive className="h-5 w-5" />}
              ok={status.setupComplete}
            >
              {status.setupComplete ? (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    すべての必要項目が揃いました。
                  </p>
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    アプリを開始 <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  上のステップを解決してから戻ってきてください。
                </p>
              )}
            </Step>
          </div>
        )}
      </div>
    </div>
  );
}

function Step({
  index,
  title,
  icon,
  ok,
  children,
}: {
  index: number;
  title: string;
  icon: React.ReactNode;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {index}
          </span>
          <span className="text-zinc-700 dark:text-zinc-300">{icon}</span>
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        </div>
        {ok ? (
          <CheckCircle className="h-5 w-5 text-emerald-500" />
        ) : (
          <XCircle className="h-5 w-5 text-zinc-300 dark:text-zinc-600" />
        )}
      </header>
      <div>{children}</div>
    </section>
  );
}

function DbDetail({ db }: { db: DbStatus }) {
  const providerLabel =
    db.provider === 'sqlite'
      ? 'SQLite (デスクトップ配布版)'
      : db.provider === 'postgresql'
        ? 'PostgreSQL (Web/サーバ版)'
        : '未設定';

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 dark:text-zinc-400">プロバイダー</span>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{providerLabel}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-zinc-500 dark:text-zinc-400">接続</span>
        <span
          className={
            db.connected
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          }
        >
          {db.connected ? 'OK' : 'エラー'}
        </span>
      </div>
      {db.filePath && (
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">ファイル</span>
          <code className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {db.filePath}
          </code>
        </div>
      )}
      {db.fileSizeBytes !== undefined && (
        <div className="flex items-center justify-between">
          <span className="text-zinc-500 dark:text-zinc-400">サイズ</span>
          <span className="text-zinc-700 dark:text-zinc-300">{formatBytes(db.fileSizeBytes)}</span>
        </div>
      )}
      {!db.connected && (
        <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {db.detail}
          {db.provider === 'sqlite' && (
            <>
              <br />
              <span className="text-[11px]">
                Tauri ビルドは起動時に自動でファイルを作成します。手動で動かしている場合は{' '}
                <code>RAPITAS_DB_PROVIDER=sqlite</code> と <code>DATABASE_URL=file:...</code>{' '}
                を設定してください。
              </span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function ProviderList({ providers }: { providers: ProviderStatus[] }) {
  return (
    <ul className="space-y-1.5">
      {providers.map((p) => (
        <li
          key={p.provider}
          className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/50"
        >
          <div className="flex items-center gap-2">
            {p.available ? (
              <CheckCircle className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-zinc-300 dark:text-zinc-600" />
            )}
            <span className="text-zinc-900 dark:text-zinc-100">{PROVIDER_LABEL[p.provider]}</span>
            {p.modelCount > 0 && (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                ({p.modelCount} モデル)
              </span>
            )}
          </div>
          {!p.available && p.reason && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{p.reason}</span>
          )}
        </li>
      ))}
      <li className="pt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        最低 1 つのプロバイダーが利用可能であれば動作します。CLI が未認証の場合は ターミナルで{' '}
        <code>claude</code> / <code>codex</code> / <code>gemini</code>{' '}
        を起動してログインしてください。
      </li>
    </ul>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-900/20">
      <div className="flex items-center gap-2">
        <XCircle className="h-5 w-5 text-red-500" />
        <h2 className="text-base font-semibold text-red-700 dark:text-red-300">
          バックエンドに接続できません
        </h2>
      </div>
      <p className="mt-2 text-sm text-red-600 dark:text-red-400">{message}</p>
      <p className="mt-2 text-xs text-red-500 dark:text-red-300">
        サーバが起動しているか、{API_BASE_URL} に到達できるかを確認してください。
      </p>
      <button
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
      >
        <RefreshCw className="h-3 w-3" /> 再試行
      </button>
    </div>
  );
}
