'use client';
// ToolCard

import {
  Terminal,
  Download,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  RefreshCcw,
  Key,
  Package,
  Monitor,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { CLITool, ToolActionState } from './types';

interface ToolCardProps {
  tool: CLITool;
  actionState: ToolActionState;
  onInstall: (toolId: string) => void;
  onUpdate: (toolId: string) => void;
  onCheckAuth: (toolId: string) => void;
  onShowAuthModal: (tool: CLITool) => void;
  onToggleCommand: (toolId: string, current: boolean) => void;
}

/**
 * Returns the status badge config (icon, label, className) for a tool.
 *
 * @param tool - The CLI tool whose status is being evaluated.
 */
function getStatusDisplay(tool: CLITool) {
  if (!tool.isInstalled) {
    return {
      icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
      label: '未インストール',
      className:
        'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    };
  }
  if (tool.isAuthenticated) {
    return {
      icon: <CheckCircle className="w-4 h-4 text-green-500" />,
      label: '認証済み',
      className:
        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    };
  }
  return {
    icon: <AlertCircle className="w-4 h-4 text-blue-500" />,
    label: 'インストール済み',
    className:
      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  };
}

/**
 * Returns the icon component appropriate for a tool category.
 *
 * @param category - The tool category string ('ai' | 'development' | 'utility').
 */
function getCategoryIcon(category: string) {
  switch (category) {
    case 'ai':
      return <Monitor className="w-5 h-5" />;
    case 'development':
      return <Package className="w-5 h-5" />;
    default:
      return <Terminal className="w-5 h-5" />;
  }
}

/**
 * Displays a single CLI tool entry with all its metadata and action buttons.
 *
 * @param tool - The CLI tool data to render.
 * @param actionState - Loading/visibility flags for this tool's actions.
 * @param onInstall - Called when the user clicks Install.
 * @param onUpdate - Called when the user clicks Update.
 * @param onCheckAuth - Called when the user clicks auth-check on an authenticated tool.
 * @param onShowAuthModal - Called when the user initiates interactive authentication.
 * @param onToggleCommand - Called when the user toggles the install-command display.
 */
export function ToolCard({
  tool,
  actionState,
  onInstall,
  onUpdate,
  onCheckAuth,
  onShowAuthModal,
  onToggleCommand,
}: ToolCardProps) {
  const statusDisplay = getStatusDisplay(tool);

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4 flex-1">
            <div className="p-2 bg-zinc-100 dark:bg-zinc-800 rounded-lg text-zinc-600 dark:text-zinc-400">
              {getCategoryIcon(tool.category)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {tool.name}
                </h3>
                <span
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${statusDisplay.className}`}
                >
                  {statusDisplay.icon}
                  {statusDisplay.label}
                </span>
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                {tool.description}
              </p>

              {/* Version and install path */}
              {tool.isInstalled && (
                <div className="flex flex-wrap items-center gap-4 mb-3">
                  {tool.version && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        バージョン:
                      </span>
                      <code className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono">
                        {tool.version}
                      </code>
                    </div>
                  )}
                  {tool.installPath && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        パス:
                      </span>
                      <code className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono truncate max-w-xs">
                        {tool.installPath}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {/* Links and show-command toggle */}
              <div className="flex flex-wrap items-center gap-4">
                {tool.installCommand && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      インストール:
                    </span>
                    <button
                      onClick={() =>
                        onToggleCommand(tool.id, actionState.showCommand)
                      }
                      className="flex items-center gap-1 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded text-xs transition-colors"
                    >
                      {actionState.showCommand ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      {actionState.showCommand ? 'Hide' : 'Show'}
                    </button>
                  </div>
                )}

                <a
                  href={tool.officialSite}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  公式サイト
                  <ExternalLink className="w-3 h-3" />
                </a>

                <a
                  href={tool.documentation}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                  ドキュメント
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {/* Expanded install command */}
              {actionState.showCommand && tool.installCommand && (
                <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                  <code className="text-sm font-mono text-zinc-800 dark:text-zinc-200">
                    {tool.installCommand}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 ml-4">
            {!tool.isInstalled ? (
              <button
                onClick={() => onInstall(tool.id)}
                disabled={actionState.isInstalling}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionState.isInstalling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                インストール
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {tool.updateCommand && (
                  <button
                    onClick={() => onUpdate(tool.id)}
                    disabled={actionState.isUpdating}
                    className="flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {actionState.isUpdating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="w-4 h-4" />
                    )}
                    更新
                  </button>
                )}

                {tool.authCommand && (
                  <button
                    onClick={() =>
                      tool.isAuthenticated
                        ? onCheckAuth(tool.id)
                        : onShowAuthModal(tool)
                    }
                    disabled={actionState.isAuthenticating}
                    className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                      tool.isAuthenticated
                        ? 'bg-green-600 hover:bg-green-700 text-white'
                        : 'bg-orange-600 hover:bg-orange-700 text-white'
                    }`}
                  >
                    {actionState.isAuthenticating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Key className="w-4 h-4" />
                    )}
                    {tool.isAuthenticated ? '認証確認' : '認証'}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
