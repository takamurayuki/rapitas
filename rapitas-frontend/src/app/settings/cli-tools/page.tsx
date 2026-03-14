'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Play,
  Copy,
  X,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { API_BASE_URL } from '@/utils/api';
import { requireAuth } from '@/contexts/AuthContext';

interface CLITool {
  id: string;
  name: string;
  description: string;
  category: 'ai' | 'development' | 'utility';
  officialSite: string;
  documentation: string;
  checkCommand: string;
  versionCommand: string;
  installCommand: string;
  updateCommand?: string;
  authCommand?: string;
  authCheck?: string;
  isInstalled: boolean;
  version: string | null;
  isAuthenticated: boolean;
  installPath?: string;
  status: 'authenticated' | 'installed' | 'not_installed';
  error?: string;
  releaseInfo?: {
    version: string;
    releaseDate: string;
    changelog: string;
    downloadUrl: string;
  };
}

interface ToolsSummary {
  total: number;
  installed: number;
  authenticated: number;
  needsUpdate: number;
}

function CLIToolsPage() {
  const [tools, setTools] = useState<CLITool[]>([]);
  const [summary, setSummary] = useState<ToolsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionStates, setActionStates] = useState<
    Record<
      string,
      {
        isInstalling: boolean;
        isUpdating: boolean;
        isAuthenticating: boolean;
        showCommand: boolean;
      }
    >
  >({});

  const updateActionState = (
    toolId: string,
    updates: Partial<(typeof actionStates)[string]>,
  ) => {
    setActionStates((prev) => ({
      ...prev,
      [toolId]: { ...prev[toolId], ...updates },
    }));
  };

  const fetchTools = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/cli-tools`);
      if (!response.ok) throw new Error('Failed to fetch CLI tools');

      const data = await response.json();
      if (data.success) {
        setTools(data.data.tools);
        setSummary(data.data.summary);

        // Initialize action states
        const initialStates: typeof actionStates = {};
        data.data.tools.forEach((tool: CLITool) => {
          initialStates[tool.id] = {
            isInstalling: false,
            isUpdating: false,
            isAuthenticating: false,
            showCommand: false,
          };
        });
        setActionStates(initialStates);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to fetch CLI tools',
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const installTool = async (toolId: string) => {
    updateActionState(toolId, { isInstalling: true });
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/cli-tools/${toolId}/install`,
        {
          method: 'POST',
        },
      );
      const data = await response.json();

      if (data.success) {
        setSuccessMessage(data.data.message);
        setTimeout(() => setSuccessMessage(null), 5000);
        await fetchTools(); // Refresh tool status
      } else {
        throw new Error(data.error || 'Installation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      updateActionState(toolId, { isInstalling: false });
    }
  };

  const updateTool = async (toolId: string) => {
    updateActionState(toolId, { isUpdating: true });
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/cli-tools/${toolId}/update`,
        {
          method: 'POST',
        },
      );
      const data = await response.json();

      if (data.success) {
        setSuccessMessage(data.data.message);
        setTimeout(() => setSuccessMessage(null), 5000);
        await fetchTools(); // Refresh tool status
      } else {
        throw new Error(data.error || 'Update failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      updateActionState(toolId, { isUpdating: false });
    }
  };

  const checkAuthentication = async (toolId: string) => {
    updateActionState(toolId, { isAuthenticating: true });
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/cli-tools/${toolId}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interactive: false }),
      });
      const data = await response.json();

      if (data.success) {
        if (data.data.isAuthenticated) {
          setSuccessMessage(`${data.data.tool.name} is already authenticated`);
        } else {
          setError(
            `${data.data.tool.name} requires authentication. ${data.data.message}`,
          );
        }
        setTimeout(() => {
          setSuccessMessage(null);
          setError(null);
        }, 5000);
        await fetchTools(); // Refresh tool status
      } else {
        throw new Error(data.error || 'Authentication check failed');
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Authentication check failed',
      );
    } finally {
      updateActionState(toolId, { isAuthenticating: false });
    }
  };

  const [authModal, setAuthModal] = useState<{
    isOpen: boolean;
    tool: CLITool | null;
    command: string | null;
    step: 'command' | 'verify' | 'completed';
  }>({
    isOpen: false,
    tool: null,
    command: null,
    step: 'command',
  });

  const showAuthModal = async (tool: CLITool) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/cli-tools/${tool.id}/auth`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interactive: true }),
        },
      );
      const data = await response.json();

      if (data.success && data.data.interactive) {
        setAuthModal({
          isOpen: true,
          tool: tool,
          command: data.data.command,
          step: 'command',
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to get auth command',
      );
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccessMessage('コマンドをクリップボードにコピーしました');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('クリップボードへのコピーに失敗しました');
    }
  };

  const verifyAuthentication = async () => {
    if (!authModal.tool) return;

    updateActionState(authModal.tool.id, { isAuthenticating: true });

    try {
      const response = await fetch(
        `${API_BASE_URL}/cli-tools/${authModal.tool.id}/auth`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interactive: false }),
        },
      );
      const data = await response.json();

      if (data.success) {
        if (data.data.isAuthenticated) {
          setAuthModal((prev) => ({ ...prev, step: 'completed' }));
          await fetchTools(); // Refresh tool status
          setTimeout(() => {
            closeAuthModal();
          }, 3000);
        } else {
          setError(
            `${authModal.tool.name}の認証が完了していません。ターミナルでコマンドを実行してください。`,
          );
        }
      } else {
        throw new Error(data.error || 'Authentication verification failed');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Authentication verification failed',
      );
    } finally {
      updateActionState(authModal.tool.id, { isAuthenticating: false });
    }
  };

  const closeAuthModal = () => {
    setAuthModal({
      isOpen: false,
      tool: null,
      command: null,
      step: 'command',
    });
  };

  const refreshTools = async () => {
    setIsRefreshing(true);
    await fetchTools();
  };

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const getStatusDisplay = (tool: CLITool) => {
    if (!tool.isInstalled) {
      return {
        icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
        label: '未インストール',
        className:
          'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
      };
    } else if (tool.isAuthenticated) {
      return {
        icon: <CheckCircle className="w-4 h-4 text-green-500" />,
        label: '認証済み',
        className:
          'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
      };
    } else {
      return {
        icon: <AlertCircle className="w-4 h-4 text-blue-500" />,
        label: 'インストール済み',
        className:
          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
      };
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'ai':
        return <Monitor className="w-5 h-5" />;
      case 'development':
        return <Package className="w-5 h-5" />;
      case 'utility':
        return <Terminal className="w-5 h-5" />;
      default:
        return <Terminal className="w-5 h-5" />;
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <Terminal className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              CLIツール管理
            </h1>
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
          <RefreshCcw
            className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          更新
        </button>
      </div>

      {/* Messages */}
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

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                <Package className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  総ツール数
                </p>
                <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {summary.total}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                <Download className="w-4 h-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  インストール済み
                </p>
                <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {summary.installed}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <Key className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  認証済み
                </p>
                <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {summary.authenticated}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <RefreshCcw className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  更新可能
                </p>
                <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {summary.needsUpdate}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools List */}
      <div className="space-y-4">
        {tools.map((tool) => {
          const statusDisplay = getStatusDisplay(tool);
          const actionState = actionStates[tool.id] || {
            isInstalling: false,
            isUpdating: false,
            isAuthenticating: false,
            showCommand: false,
          };

          return (
            <div
              key={tool.id}
              className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
            >
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

                      {/* Version and Path Info */}
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

                      {/* Commands */}
                      <div className="flex flex-wrap items-center gap-4">
                        {tool.installCommand && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500 dark:text-zinc-400">
                              インストール:
                            </span>
                            <button
                              onClick={() =>
                                updateActionState(tool.id, {
                                  showCommand: !actionState.showCommand,
                                })
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

                        <div className="flex items-center gap-2">
                          <a
                            href={tool.officialSite}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            公式サイト
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>

                        <div className="flex items-center gap-2">
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
                      </div>

                      {/* Show Command */}
                      {actionState.showCommand && tool.installCommand && (
                        <div className="mt-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg">
                          <code className="text-sm font-mono text-zinc-800 dark:text-zinc-200">
                            {tool.installCommand}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {!tool.isInstalled ? (
                      <button
                        onClick={() => installTool(tool.id)}
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
                            onClick={() => updateTool(tool.id)}
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
                                ? checkAuthentication(tool.id)
                                : showAuthModal(tool)
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
        })}
      </div>

      {/* Authentication Modal */}
      {authModal.isOpen && authModal.tool && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                    <Key className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                      {authModal.tool.name} の認証
                    </h2>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      ターミナルでコマンドを実行して認証を完了してください
                    </p>
                  </div>
                </div>
                <button
                  onClick={closeAuthModal}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              {authModal.step === 'command' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-3">
                      ステップ 1: ターミナルでコマンドを実行
                    </h3>
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
                          認証コマンド
                        </span>
                        <button
                          onClick={() =>
                            copyToClipboard(authModal.command || '')
                          }
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          コピー
                        </button>
                      </div>
                      <code className="block p-3 bg-zinc-900 dark:bg-zinc-950 text-green-400 rounded text-sm font-mono overflow-x-auto">
                        {authModal.command}
                      </code>
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-start gap-3">
                      <div className="p-1 bg-blue-100 dark:bg-blue-900/30 rounded">
                        <Terminal className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                          実行手順
                        </h4>
                        <ol className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                          <li>1. 上記のコマンドをコピーしてください</li>
                          <li>
                            2.
                            ターミナル（コマンドプロンプトまたはPowerShell）を開いてください
                          </li>
                          <li>3. コマンドを貼り付けて実行してください</li>
                          <li>4. ブラウザで認証プロセスを完了してください</li>
                          <li>
                            5. 下記の「認証確認」ボタンをクリックしてください
                          </li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={closeAuthModal}
                      className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                      キャンセル
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={() =>
                          setAuthModal((prev) => ({ ...prev, step: 'verify' }))
                        }
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      >
                        <Play className="w-4 h-4" />
                        認証確認へ
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {authModal.step === 'verify' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-3">
                      ステップ 2: 認証状況を確認
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                      ターミナルで認証コマンドを実行しましたか？下記のボタンをクリックして認証状況を確認してください。
                    </p>

                    <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-200 dark:border-amber-800">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <div className="text-sm text-amber-800 dark:text-amber-200">
                          <p className="mb-1">
                            認証が完了していない場合は、以下を確認してください：
                          </p>
                          <ul className="text-xs space-y-1 ml-2">
                            <li>• ターミナルでコマンドを正しく実行したか</li>
                            <li>• ブラウザでの認証プロセスを完了したか</li>
                            <li>• ターミナルでエラーが表示されていないか</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <button
                      onClick={() =>
                        setAuthModal((prev) => ({ ...prev, step: 'command' }))
                      }
                      className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                      戻る
                    </button>
                    <div className="flex gap-3">
                      <button
                        onClick={closeAuthModal}
                        className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        onClick={verifyAuthentication}
                        disabled={
                          actionStates[authModal.tool.id]?.isAuthenticating
                        }
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {actionStates[authModal.tool.id]?.isAuthenticating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        認証確認
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {authModal.step === 'completed' && (
                <div className="space-y-6">
                  <div className="text-center">
                    <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full mx-auto w-fit mb-4">
                      <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </div>
                    <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-50 mb-2">
                      認証が完了しました！
                    </h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {authModal.tool.name}
                      の認証が正常に完了しました。CLIツールをご利用いただけます。
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                      このダイアログは3秒後に自動的に閉じます
                    </p>
                  </div>

                  <div className="flex justify-center">
                    <button
                      onClick={closeAuthModal}
                      className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      完了
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default requireAuth(CLIToolsPage);
