'use client';
// CLIToolsPage

import { Terminal, AlertCircle, CheckCircle, RefreshCcw, Info } from 'lucide-react';
import { requireAuth } from '@/contexts/AuthContext';
import { useCLITools } from './useCliTools';
import { ToolCard } from './ToolCard';
import { useTerminalStore } from '@/feature/terminal/terminal-store';
import type { CLITool } from './types';

/** Page header — reused by the loading skeleton so its layout matches exactly. */
function PageHeader({
  onRefresh,
  isRefreshing,
}: {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
          <Terminal className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">CLIツール管理</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            AI CLI ツールのインストール・バージョン管理・認証
          </p>
        </div>
      </div>
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
      >
        <RefreshCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        更新
      </button>
    </div>
  );
}

/** One tool-card skeleton mirroring ToolCard's layout (icon, title, badge, desc, action). */
function ToolCardSkeleton() {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
          <div className="w-9 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2.5">
            <div className="flex items-center gap-3">
              <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-6 w-24 bg-zinc-200 dark:bg-zinc-800 rounded-full" />
            </div>
            <div className="h-3.5 w-64 bg-zinc-200 dark:bg-zinc-800 rounded" />
            <div className="flex gap-4">
              <div className="h-3 w-16 bg-zinc-200 dark:bg-zinc-800 rounded" />
              <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-800 rounded" />
            </div>
          </div>
        </div>
        <div className="h-9 w-28 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
      </div>
    </div>
  );
}

function CLIToolsPage() {
  const {
    tools,
    isLoading,
    isRefreshing,
    error,
    successMessage,
    actionStates,
    refreshTools,
    updateTool,
    checkAuthentication,
    updateActionState,
  } = useCLITools();

  // Install AND auth both run IN the rapitas integrated terminal (interactive):
  // open a tab with the command pre-filled so the user reviews it, answers any
  // prompts (winget agreements, gh device-flow code, etc.) and presses Enter —
  // instead of a non-interactive backend exec that can't do interactive auth.
  const runInTerminal = (title: string, command?: string) => {
    if (!command) return;
    useTerminalStore.getState().openTerminalForTask({ title, command });
  };
  const handleInstall = (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId);
    runInTerminal(tool?.name ?? 'install', tool?.installCommand);
  };
  const handleAuthenticate = (tool: CLITool) => {
    runInTerminal(`${tool.name} 認証`, tool.authCommand);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <PageHeader />
        <div className="space-y-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <ToolCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <PageHeader onRefresh={refreshTools} isRefreshing={isRefreshing} />

      {/* How install/auth works here */}
      <div className="mb-6 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            インストール・認証は rapitas のターミナルで実行されます（コマンドがプリフィルされるので
            Enter で実行）。完了後「更新」で状態を再確認できます。なお、新しく入れたツールを
            <strong>エージェントが使う</strong>には dev サーバーの再起動が必要です。
          </span>
        </div>
      </div>

      {/* Status messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <CheckCircle className="w-5 h-5" />
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      {/* Tool list (compact) */}
      <div className="space-y-2.5">
        {tools.map((tool) => {
          const actionState = actionStates[tool.id] ?? {
            isInstalling: false,
            isUpdating: false,
            isAuthenticating: false,
            showCommand: false,
          };

          return (
            <ToolCard
              key={tool.id}
              tool={tool}
              actionState={actionState}
              onInstall={handleInstall}
              onUpdate={updateTool}
              onCheckAuth={checkAuthentication}
              onAuthenticate={handleAuthenticate}
              onToggleCommand={(id, current) => updateActionState(id, { showCommand: !current })}
            />
          );
        })}
      </div>
    </div>
  );
}

export default requireAuth(CLIToolsPage);
