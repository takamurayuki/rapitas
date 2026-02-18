'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  FileCode,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Layers,
  Zap,
  Link2,
  Unlink,
  Info,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  useSSE,
  type SSEErrorData,
  type SSERollbackData,
  type SSERetryData,
} from '@/hooks/use-sse';
import { API_BASE_URL } from '@/utils/api';

// Types
type DependencyInfo = {
  taskId: number;
  title: string;
  files: string[];
  dependencies: Array<{
    taskId: number;
    title: string;
    sharedFiles: string[];
    dependencyScore: number;
  }>;
  independenceScore: number;
  canRunParallel: boolean;
};

type TreeNode = {
  id: number;
  title: string;
  files: string[];
  independenceScore: number;
  canRunParallel: boolean;
  level: number;
  children: TreeNode[];
  dependsOn: Array<{ id: number; title: string; sharedFiles: string[] }>;
};

type ParallelGroup = {
  groupId: number;
  tasks: Array<{ id: number; title: string }>;
  canRunTogether: boolean;
};

type AnalysisResult = {
  taskId: number;
  taskTitle: string;
  hasSubtasks: boolean;
  subtaskCount: number;
  analysis: DependencyInfo[];
  tree: TreeNode[];
  parallelGroups: ParallelGroup[];
  summary: {
    totalTasks: number;
    independentTasks: number;
    dependentTasks: number;
    totalFiles: number;
    averageIndependence: number;
  };
};

type Props = {
  taskId: number;
};

// ツリーノードコンポーネント
function TreeNodeItem({
  node,
  isExpanded,
  onToggle,
  depth = 0,
}: {
  node: TreeNode;
  isExpanded: boolean;
  onToggle: () => void;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;
  const hasDependencies = node.dependsOn.length > 0;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600 dark:text-green-400';
    if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 80) return 'bg-green-100 dark:bg-green-900/30';
    if (score >= 50) return 'bg-yellow-100 dark:bg-yellow-900/30';
    return 'bg-red-100 dark:bg-red-900/30';
  };

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors ${
          depth > 0
            ? 'ml-6 border-l-2 border-zinc-200 dark:border-zinc-700'
            : ''
        }`}
      >
        {/* 展開ボタン */}
        <button
          onClick={onToggle}
          className={`p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 ${
            !hasChildren && !hasDependencies ? 'invisible' : ''
          }`}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {/* ステータスアイコン */}
        {node.canRunParallel ? (
          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        )}

        {/* タスク名 */}
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate flex-1">
          {node.title}
        </span>

        {/* 独立性スコア */}
        <span
          className={`px-2 py-0.5 text-xs rounded ${getScoreBgColor(node.independenceScore)} ${getScoreColor(node.independenceScore)}`}
        >
          {node.independenceScore}%
        </span>

        {/* ファイル数 */}
        {node.files.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <FileCode className="w-3 h-3" />
            {node.files.length}
          </span>
        )}
      </div>

      {/* 展開時の詳細 */}
      {isExpanded && (
        <div className="ml-10 mt-1 space-y-2">
          {/* 依存関係 */}
          {hasDependencies && (
            <div className="p-2 bg-amber-50 dark:bg-amber-900/10 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 mb-1">
                <Link2 className="w-3 h-3" />
                <span className="font-medium">依存関係</span>
              </div>
              <div className="space-y-1">
                {node.dependsOn.map((dep) => (
                  <div
                    key={dep.id}
                    className="text-xs text-amber-600 dark:text-amber-400"
                  >
                    <span className="font-medium">{dep.title}</span>
                    <span className="text-amber-500 dark:text-amber-500 ml-2">
                      ({dep.sharedFiles.join(', ')})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ファイル一覧 */}
          {node.files.length > 0 && (
            <div className="p-2 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
              <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                <FileCode className="w-3 h-3" />
                <span className="font-medium">関連ファイル</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {node.files.slice(0, 10).map((file, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 rounded font-mono"
                  >
                    {file.split('/').pop()}
                  </span>
                ))}
                {node.files.length > 10 && (
                  <span className="text-xs text-zinc-500">
                    +{node.files.length - 10} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 子ノード */}
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              isExpanded={false}
              onToggle={() => {}}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DependencyTree({ taskId }: Props) {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'tree' | 'list' | 'groups'>('tree');
  const [useSSEMode, setUseSSEMode] = useState(true);

  // SSE フックを使用
  const {
    isLoading,
    progress,
    progressMessage,
    data: sseData,
    error: sseError,
    retryInfo,
    rollbackInfo,
    connect,
    reset,
  } = useSSE<AnalysisResult>({
    onComplete: () => {
      console.log('SSE analysis completed');
    },
    onError: (error) => {
      console.error('SSE error:', error);
    },
    onRetry: (info) => {
      console.log('Retrying:', info);
    },
    onRollback: (info) => {
      console.log('Rollback:', info);
    },
  });

  // 通常のフェッチ用の状態
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isLoadingFallback, setIsLoadingFallback] = useState(false);
  const [errorFallback, setErrorFallback] = useState<string | null>(null);

  // SSE分析を開始
  const startSSEAnalysis = useCallback(() => {
    reset();
    connect(`${API_BASE_URL}/tasks/${taskId}/dependency-analysis/stream`);
  }, [taskId, connect, reset]);

  // フォールバック用の通常フェッチ
  const fetchAnalysisFallback = useCallback(async () => {
    setIsLoadingFallback(true);
    setErrorFallback(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/tasks/${taskId}/dependency-analysis`,
      );
      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
      } else {
        const errData = await res.json();
        throw new Error(errData.error || '分析に失敗しました');
      }
    } catch (err) {
      setErrorFallback(
        err instanceof Error ? err.message : 'エラーが発生しました',
      );
    } finally {
      setIsLoadingFallback(false);
    }
  }, [taskId]);

  // 初回マウント時にSSE分析を開始
  useEffect(() => {
    if (useSSEMode) {
      startSSEAnalysis();
    } else {
      fetchAnalysisFallback();
    }
  }, [useSSEMode, startSSEAnalysis, fetchAnalysisFallback]);

  const toggleNode = (nodeId: number) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // 現在のデータソースを取得
  const currentAnalysis = useSSEMode ? sseData : analysis;
  const currentIsLoading = useSSEMode ? isLoading : isLoadingFallback;
  const currentError = useSSEMode
    ? sseError
    : errorFallback
      ? { error: errorFallback }
      : null;

  const expandAll = () => {
    if (currentAnalysis) {
      const allIds = new Set(currentAnalysis.analysis.map((a) => a.taskId));
      setExpandedNodes(allIds);
    }
  };

  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // リトライ中の表示
  if (retryInfo && isLoading) {
    return (
      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
        <div className="flex items-center gap-3 mb-3">
          <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400 animate-spin" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              リトライ中... ({retryInfo.retryCount}/{retryInfo.maxRetries})
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {retryInfo.reason}
            </p>
          </div>
        </div>
        <div className="w-full bg-amber-200 dark:bg-amber-800 rounded-full h-1.5">
          <div
            className="bg-amber-600 h-1.5 rounded-full transition-all duration-300"
            style={{
              width: `${(retryInfo.retryCount / retryInfo.maxRetries) * 100}%`,
            }}
          />
        </div>
      </div>
    );
  }

  // ロールバック通知
  if (rollbackInfo) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <div className="flex items-center gap-3 mb-3">
          <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              処理に失敗しました
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">
              {rollbackInfo.rollbackReason}
            </p>
          </div>
        </div>
        <p className="text-xs text-red-600 dark:text-red-400 mb-3">
          エラー詳細: {rollbackInfo.errorDetails}
        </p>
        <div className="flex gap-2">
          <button
            onClick={startSSEAnalysis}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            再試行
          </button>
          <button
            onClick={() => {
              setUseSSEMode(false);
              reset();
            }}
            className="px-3 py-1.5 text-red-600 hover:text-red-700 text-sm"
          >
            通常モードで試す
          </button>
        </div>
      </div>
    );
  }

  // 読み込み中（進捗バー付き）
  if (currentIsLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-violet-500 animate-spin" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {progressMessage || '依存関係を分析中...'}
          </span>
        </div>
        {useSSEMode && progress > 0 && (
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
            <div
              className="bg-violet-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  // エラー表示
  if (currentError) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm font-medium">エラーが発生しました</span>
        </div>
        <p className="text-sm text-red-600 dark:text-red-400 mb-3">
          {currentError.error}
        </p>
        <div className="flex gap-2">
          <button
            onClick={useSSEMode ? startSSEAnalysis : fetchAnalysisFallback}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-sm rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            再試行
          </button>
          {useSSEMode && (
            <button
              onClick={() => {
                setUseSSEMode(false);
                reset();
              }}
              className="px-3 py-1.5 text-red-600 hover:text-red-700 text-sm"
            >
              通常モードで試す
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!currentAnalysis) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            依存度分析
          </span>
          {useSSEMode && (
            <span className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs rounded">
              SSE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={useSSEMode ? startSSEAnalysis : fetchAnalysisFallback}
            disabled={currentIsLoading}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded"
            title="更新"
          >
            <RefreshCw
              className={`w-4 h-4 ${currentIsLoading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <Layers className="w-3 h-3" />
            タスク数
          </div>
          <div className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            {currentAnalysis.summary.totalTasks}
          </div>
        </div>
        <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400 mb-1">
            <Unlink className="w-3 h-3" />
            独立タスク
          </div>
          <div className="text-lg font-bold text-green-700 dark:text-green-300">
            {currentAnalysis.summary.independentTasks}
          </div>
        </div>
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-1">
            <Link2 className="w-3 h-3" />
            依存タスク
          </div>
          <div className="text-lg font-bold text-amber-700 dark:text-amber-300">
            {currentAnalysis.summary.dependentTasks}
          </div>
        </div>
        <div className="p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
          <div className="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400 mb-1">
            <Zap className="w-3 h-3" />
            平均独立性
          </div>
          <div className="text-lg font-bold text-violet-700 dark:text-violet-300">
            {currentAnalysis.summary.averageIndependence}%
          </div>
        </div>
      </div>

      {/* ビューモード切り替え */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          onClick={() => setViewMode('tree')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            viewMode === 'tree'
              ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          ツリー表示
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            viewMode === 'list'
              ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          リスト表示
        </button>
        <button
          onClick={() => setViewMode('groups')}
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            viewMode === 'groups'
              ? 'text-violet-600 dark:text-violet-400 border-b-2 border-violet-600'
              : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          グループ表示
        </button>
        <div className="flex-1" />
        <button
          onClick={expandAll}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          すべて展開
        </button>
        <button
          onClick={collapseAll}
          className="text-xs text-zinc-500 hover:text-zinc-700"
        >
          すべて折りたたむ
        </button>
      </div>

      {/* コンテンツ */}
      <div className="max-h-96 overflow-y-auto">
        {viewMode === 'tree' && (
          <div className="space-y-1">
            {currentAnalysis.tree.map((node) => (
              <TreeNodeItem
                key={node.id}
                node={node}
                isExpanded={expandedNodes.has(node.id)}
                onToggle={() => toggleNode(node.id)}
              />
            ))}
            {currentAnalysis.tree.length === 0 && (
              <div className="text-center py-8 text-zinc-500">
                <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  分析対象のサブタスクまたはプロンプトがありません
                </p>
              </div>
            )}
          </div>
        )}

        {viewMode === 'list' && (
          <div className="space-y-2">
            {currentAnalysis.analysis
              .sort((a, b) => b.independenceScore - a.independenceScore)
              .map((item) => (
                <div
                  key={item.taskId}
                  className="p-3 bg-zinc-50 dark:bg-indigo-dark-800/50 rounded-lg"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {item.canRunParallel ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {item.title}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded ${
                        item.independenceScore >= 80
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-600'
                          : item.independenceScore >= 50
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-600'
                      }`}
                    >
                      独立性: {item.independenceScore}%
                    </span>
                  </div>
                  {item.dependencies.length > 0 && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-medium">依存先:</span>{' '}
                      {item.dependencies.map((d) => d.title).join(', ')}
                    </div>
                  )}
                  {item.files.length > 0 && (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      <span className="font-medium">ファイル:</span>{' '}
                      {item.files.length}件
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}

        {viewMode === 'groups' && (
          <div className="space-y-4">
            {currentAnalysis.parallelGroups.map((group) => (
              <div
                key={group.groupId}
                className={`p-4 rounded-lg border ${
                  group.canRunTogether
                    ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                    : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-3">
                  {group.canRunTogether ? (
                    <>
                      <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm font-medium text-green-700 dark:text-green-300">
                        並列実行可能 ({group.tasks.length}件)
                      </span>
                    </>
                  ) : (
                    <>
                      <Link2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        順次実行推奨 ({group.tasks.length}件)
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.tasks.map((task) => (
                    <span
                      key={task.id}
                      className={`px-2 py-1 text-xs rounded ${
                        group.canRunTogether
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {task.title}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {currentAnalysis.parallelGroups.length === 0 && (
              <div className="text-center py-8 text-zinc-500">
                <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">グループ化できるタスクがありません</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 凡例 */}
      <div className="flex items-center gap-4 pt-3 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          <span>並列実行可能</span>
        </div>
        <div className="flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span>依存関係あり</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 rounded">
            80%+
          </span>
          <span>高い独立性</span>
        </div>
      </div>
    </div>
  );
}
