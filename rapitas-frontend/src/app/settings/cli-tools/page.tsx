'use client';
// CLIToolsPage

import { Terminal, AlertCircle, CheckCircle, RefreshCcw } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { requireAuth } from '@/contexts/AuthContext';
import { useCLITools } from './useCliTools';
import { ToolSummaryCards } from './ToolSummaryCards';
import { ToolCard } from './ToolCard';
import { AuthModal } from './AuthModal';

function CLIToolsPage() {
  const {
    tools,
    summary,
    isLoading,
    isRefreshing,
    error,
    successMessage,
    actionStates,
    authModal,
    refreshTools,
    installTool,
    updateTool,
    checkAuthentication,
    showAuthModal,
    closeAuthModal,
    verifyAuthentication,
    copyToClipboard,
    updateActionState,
    setAuthModal,
  } = useCLITools();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
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
          onClick={refreshTools}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCcw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          更新
        </button>
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

      {/* Summary statistics */}
      {summary && <ToolSummaryCards summary={summary} />}

      {/* Tool list */}
      <div className="space-y-4">
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
              onInstall={installTool}
              onUpdate={updateTool}
              onCheckAuth={checkAuthentication}
              onShowAuthModal={showAuthModal}
              onToggleCommand={(id, current) => updateActionState(id, { showCommand: !current })}
            />
          );
        })}
      </div>

      {/* Interactive authentication modal */}
      <AuthModal
        authModal={authModal}
        actionStates={actionStates}
        onClose={closeAuthModal}
        onVerify={verifyAuthentication}
        onCopy={copyToClipboard}
        setStep={(step) => setAuthModal((prev) => ({ ...prev, step }))}
      />
    </div>
  );
}

export default requireAuth(CLIToolsPage);
