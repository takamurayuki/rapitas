'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  WorkflowFileType,
  WorkflowStatus,
  WorkflowRole,
  WorkflowRoleConfig,
} from '@/types';
import { useWorkflowFiles } from '@/hooks/useWorkflowFiles';
import { API_BASE_URL } from '@/utils/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CompactWorkflowSelector, {
  type WorkflowMode,
} from './CompactWorkflowSelector';
import {
  Search,
  FileText,
  CheckCircle,
  MessageSquare,
  AlertCircle,
  Loader2,
  FolderOpen,
  RefreshCw,
  Play,
  Code,
  ShieldCheck,
  Clock,
} from 'lucide-react';

export interface WorkflowViewerProps {
  taskId: number;
  workflowStatus?: WorkflowStatus | null;
  workflowMode?: WorkflowMode | null;
  complexityScore?: number | null;
  workflowModeOverride?: boolean;
  autoApprovePlan?: boolean;
  onPlanApprovalRequest?: () => void;
  onCompleteRequest?: () => void;
  onStatusChange?: (newStatus: WorkflowStatus) => void;
  onWorkflowModeChange?: (mode: WorkflowMode, isOverride: boolean) => void;
  onAutoApprovePlanChange?: (value: boolean) => void;
  showWorkflowMode?: boolean;
  className?: string;
}

// Tab definitions by workflow mode
const getWorkflowTabs = (workflowMode: string) => {
  const allTabs = [
    {
      id: 'research' as const,
      label: '調査',
      icon: Search,
      emptyText: 'AIエージェントが調査を実行するとresearch.mdが生成されます',
    },
    {
      id: 'question' as const,
      label: 'Q&A',
      icon: MessageSquare,
      emptyText: '不明点がある場合、AIエージェントがquestion.mdを生成します',
    },
    {
      id: 'plan' as const,
      label: '計画',
      icon: FileText,
      emptyText: '調査完了後にAIエージェントがplan.mdを生成します',
    },
    {
      id: 'verify' as const,
      label: '検証',
      icon: CheckCircle,
      emptyText: '実装完了後にAIエージェントがverify.mdを生成します',
    },
  ];

  switch (workflowMode) {
    case 'lightweight':
      // Lightweight mode: implementation and verification only
      return allTabs.filter((tab) => ['verify'].includes(tab.id));
    case 'standard':
      // Standard mode: plan, Q&A, verification
      return allTabs.filter((tab) =>
        ['question', 'plan', 'verify'].includes(tab.id),
      );
    case 'comprehensive':
    default:
      // Comprehensive mode: all tabs
      return allTabs;
  }
};

// Step mapping by workflow mode
const getStatusToNextRole = (workflowMode: string) => {
  const lightweightMode: Record<
    string,
    { role: WorkflowRole; label: string; icon: typeof Search }
  > = {
    draft: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: {
      role: 'auto_verifier',
      label: '自動検証実行',
      icon: CheckCircle,
    },
  };

  const standardMode: Record<
    string,
    { role: WorkflowRole; label: string; icon: typeof Search }
  > = {
    draft: { role: 'planner', label: '計画作成', icon: FileText },
    plan_created: {
      role: 'reviewer',
      label: 'レビュー実行',
      icon: MessageSquare,
    },
    plan_approved: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: { role: 'verifier', label: '検証実行', icon: CheckCircle },
  };

  const comprehensiveMode: Record<
    string,
    { role: WorkflowRole; label: string; icon: typeof Search }
  > = {
    draft: { role: 'researcher', label: 'リサーチ実行', icon: Search },
    research_done: { role: 'planner', label: '計画作成', icon: FileText },
    plan_created: {
      role: 'reviewer',
      label: 'レビュー実行',
      icon: MessageSquare,
    },
    plan_approved: { role: 'implementer', label: '実装開始', icon: Code },
    in_progress: { role: 'verifier', label: '検証実行', icon: CheckCircle },
  };

  switch (workflowMode) {
    case 'lightweight':
      return lightweightMode;
    case 'standard':
      return standardMode;
    case 'comprehensive':
    default:
      return comprehensiveMode;
  }
};

// Auto-selection mapping for tabs corresponding to status
const STATUS_TO_TAB: Partial<Record<WorkflowStatus, WorkflowFileType>> = {
  research_done: 'research',
  plan_created: 'plan',
  in_progress: 'plan',
  verify_done: 'verify',
  completed: 'verify',
};

export default function WorkflowViewer({
  taskId,
  workflowStatus,
  workflowMode = null,
  complexityScore = null,
  workflowModeOverride = false,
  autoApprovePlan = false,
  onPlanApprovalRequest,
  onCompleteRequest,
  onStatusChange,
  onWorkflowModeChange,
  onAutoApprovePlanChange,
  showWorkflowMode = true,
  className = '',
}: WorkflowViewerProps) {
  const [activeTab, setActiveTab] = useState<WorkflowFileType>('research');
  const {
    files,
    isLoading,
    error,
    refetch,
    workflowPath,
    workflowStatus: fetchedStatus,
  } = useWorkflowFiles(taskId);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [roles, setRoles] = useState<WorkflowRoleConfig[]>([]);
  const [autoComplexityAnalysis, setAutoComplexityAnalysis] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatusRef = useRef<WorkflowStatus | null>(null);

  // Effective status: reflects prop updates immediately without waiting for fetch to catch up
  // Uses prop when it's ahead based on workflowStatus StatusOrder comparison
  const STATUS_ORDER: Record<string, number> = {
    draft: 0,
    research_done: 1,
    plan_created: 2,
    plan_approved: 3,
    in_progress: 4,
    verify_done: 5,
    completed: 6,
  };
  const effectiveStatus = (() => {
    if (!fetchedStatus && !workflowStatus) return null;
    if (!fetchedStatus) return workflowStatus || null;
    if (!workflowStatus) return fetchedStatus;
    // Prioritize prop if it's ahead of fetchedStatus
    const propOrder = STATUS_ORDER[workflowStatus] ?? -1;
    const fetchOrder = STATUS_ORDER[fetchedStatus] ?? -1;
    return propOrder >= fetchOrder ? workflowStatus : fetchedStatus;
  })();

  // Notify parent when fetchedStatus changes
  useEffect(() => {
    if (fetchedStatus && fetchedStatus !== prevStatusRef.current) {
      prevStatusRef.current = fetchedStatus;
      if (onStatusChange && fetchedStatus !== workflowStatus) {
        onStatusChange(fetchedStatus);
      }
    }
  }, [fetchedStatus, workflowStatus, onStatusChange]);

  // Refetch WorkflowViewer files when parent workflowStatus prop is updated
  const prevWorkflowStatusPropRef = useRef<WorkflowStatus | null | undefined>(
    workflowStatus,
  );
  useEffect(() => {
    if (
      workflowStatus &&
      workflowStatus !== prevWorkflowStatusPropRef.current
    ) {
      prevWorkflowStatusPropRef.current = workflowStatus;
      refetch();
    }
  }, [workflowStatus, refetch]);

  // Auto-switch tabs on status change
  useEffect(() => {
    if (effectiveStatus) {
      const tab = STATUS_TO_TAB[effectiveStatus];
      if (tab) {
        setActiveTab(tab);
      }
    }
  }, [effectiveStatus]);

  // Fetch role configuration
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow-roles`);
        if (res.ok) {
          setRoles(await res.json());
        }
      } catch {
        // ignore
      }
    };
    fetchRoles();
  }, []);

  // Fetch auto-complexity analysis settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        if (res.ok) {
          const data = await res.json();
          setAutoComplexityAnalysis(data.autoComplexityAnalysis ?? false);
        }
      } catch {
        // ignore
      }
    };
    fetchSettings();
  }, []);

  // Polling start/stop helpers
  const startPolling = useCallback(
    (intervalMs: number = 3000) => {
      stopPolling();
      pollingRef.current = setInterval(() => {
        refetch();
      }, intervalMs);
    },
    [refetch],
  );

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Stop polling on component unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const handleAdvance = useCallback(async () => {
    setIsAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/workflow/tasks/${taskId}/advance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        setAdvanceError(data.error || 'フェーズの実行に失敗しました');
      } else if (data.async) {
        // Async execution: monitor state with polling
        startPolling(3000);
      } else {
        // Sync completion: refetch immediately
        await refetch();
      }
    } catch (err) {
      setAdvanceError(
        err instanceof Error ? err.message : 'エラーが発生しました',
      );
    } finally {
      setIsAdvancing(false);
    }
  }, [taskId, refetch, startPolling]);

  // Stop polling and refetch when status reaches final state
  const prevFetchedStatusRef = useRef<WorkflowStatus | null>(null);
  useEffect(() => {
    if (
      fetchedStatus &&
      fetchedStatus !== prevFetchedStatusRef.current &&
      pollingRef.current
    ) {
      prevFetchedStatusRef.current = fetchedStatus;
      // Stop polling when reaching final states (completed, verify_done)
      if (fetchedStatus === 'completed' || fetchedStatus === 'verify_done') {
        stopPolling();
      }
      // Update file content
      refetch();
    }
    if (fetchedStatus && !prevFetchedStatusRef.current) {
      prevFetchedStatusRef.current = fetchedStatus;
    }
  }, [fetchedStatus, stopPolling, refetch]);

  // Start polling when plan_approved as backend will auto-advance
  useEffect(() => {
    if (effectiveStatus === 'plan_approved' && !pollingRef.current) {
      startPolling(3000);
    }
  }, [effectiveStatus, startPolling]);

  const activeFile = useMemo(() => {
    if (!files) return null;
    return files[activeTab];
  }, [files, activeTab]);

  const tabStatus = useMemo(() => {
    if (!files)
      return { research: false, question: false, plan: false, verify: false };
    return {
      research: files.research.exists,
      question: files.question.exists,
      plan: files.plan.exists,
      verify: files.verify.exists,
    };
  }, [files]);

  const workflowTabs = getWorkflowTabs(workflowMode || 'comprehensive');

  // Fallback to first tab if activeTab doesn't exist in current mode
  const validActiveTab = workflowTabs.some((t) => t.id === activeTab)
    ? activeTab
    : (workflowTabs[0]?.id ?? 'research');
  useEffect(() => {
    if (validActiveTab !== activeTab) {
      setActiveTab(validActiveTab);
    }
  }, [validActiveTab, activeTab]);
  const activeTabConfig = workflowTabs.find((t) => t.id === validActiveTab)!;

  // Always show approval banner during plan_created
  const isPlanAwaitingApproval =
    tabStatus.plan &&
    effectiveStatus === 'plan_created' &&
    onPlanApprovalRequest;

  // Approval button within plan tab
  const showApprovalButton = activeTab === 'plan' && isPlanAwaitingApproval;

  // Complete button display condition (user explicitly completes after verification)
  const showCompleteButton =
    activeTab === 'verify' &&
    tabStatus.verify &&
    effectiveStatus === 'verify_done' &&
    onCompleteRequest;

  // Whether async execution is in progress
  const isPolling = pollingRef.current !== null;

  return (
    <div className={className}>
      {/* Path information */}
      {workflowPath && (
        <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
          <FolderOpen className="h-3 w-3" />
          <span>{workflowPath.dir}</span>
        </div>
      )}

      {/* Workflow mode selection section */}
      {showWorkflowMode && (
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-100 dark:border-zinc-800">
          <CompactWorkflowSelector
            taskId={taskId}
            currentMode={workflowMode}
            isOverridden={workflowModeOverride}
            complexityScore={complexityScore}
            autoComplexityAnalysis={autoComplexityAnalysis}
            onModeChange={onWorkflowModeChange}
            onAnalysisComplete={(analysis) => {
              // Notify parent component when analysis completes
              if (onWorkflowModeChange && !workflowModeOverride) {
                onWorkflowModeChange(analysis.recommendedMode, false);
              }
            }}
            disabled={
              effectiveStatus === 'in_progress' ||
              effectiveStatus === 'completed'
            }
            showAnalyzeButton={true}
          />

          {/* Auto-approval settings for plans */}
          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoApprovePlan}
                onChange={(e) => onAutoApprovePlanChange?.(e.target.checked)}
                disabled={
                  effectiveStatus === 'in_progress' ||
                  effectiveStatus === 'completed'
                }
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                計画を自動承認
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                (plan.md保存時に承認待ちをスキップ)
              </span>
            </label>
          </div>
        </div>
      )}

      {/* Approval pending banner (always shown during plan_created) */}
      {isPlanAwaitingApproval && (
        <div className="flex items-center justify-between px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/50">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-amber-100 dark:bg-amber-800/50 rounded-full">
              <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                計画の承認が必要です
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                計画タブで内容を確認し、承認すると実装フェーズに移行します
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setActiveTab('plan');
              onPlanApprovalRequest?.();
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            計画を確認・承認
          </button>
        </div>
      )}

      {/* Verification complete banner (shown during verify_done) */}
      {effectiveStatus === 'verify_done' &&
        tabStatus.verify &&
        onCompleteRequest && (
          <div className="flex items-center justify-between px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800/50">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-teal-100 dark:bg-teal-800/50 rounded-full">
                <CheckCircle className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-teal-800 dark:text-teal-200">
                  検証が完了しました
                </p>
                <p className="text-xs text-teal-600 dark:text-teal-400">
                  検証タブで内容を確認し、問題なければタスクを完了にしてください
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setActiveTab('verify');
                onCompleteRequest();
              }}
              className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              検証結果を確認
            </button>
          </div>
        )}

      {/* Async execution in progress banner */}
      {isPolling && (
        <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800/50">
          <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
              AIエージェントが実行中です...
            </p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              完了すると自動的に表示が更新されます
            </p>
          </div>
        </div>
      )}

      {/* Next phase execution button */}
      {effectiveStatus &&
        effectiveStatus !== 'completed' &&
        effectiveStatus !== 'plan_created' &&
        !isPolling &&
        (() => {
          const statusToNextRole = getStatusToNextRole(
            workflowMode || 'comprehensive',
          );
          const next = statusToNextRole[effectiveStatus];
          if (!next) return null;

          const roleConfig = roles.find((r) => r.role === next.role);
          const NextIcon = next.icon;

          return (
            <div className="flex items-center justify-between px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-800/50">
              <div className="flex items-center gap-2 text-sm">
                <NextIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-indigo-700 dark:text-indigo-300 font-medium">
                  次: {next.label}
                </span>
                {roleConfig?.agentConfig && (
                  <span className="text-xs text-indigo-500 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-800/50 px-2 py-0.5 rounded-full">
                    {roleConfig.agentConfig.name}
                  </span>
                )}
              </div>
              <button
                onClick={handleAdvance}
                disabled={isAdvancing || !roleConfig?.agentConfigId}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isAdvancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {isAdvancing ? '実行中...' : '実行'}
              </button>
            </div>
          );
        })()}

      {/* Execution error display */}
      {advanceError && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-4 py-2">
          <div className="flex items-center">
            <AlertCircle className="h-4 w-4 text-red-500 mr-2 shrink-0" />
            <span className="text-sm text-red-700 dark:text-red-300">
              {advanceError}
            </span>
            <button
              onClick={() => setAdvanceError(null)}
              className="ml-auto text-red-400 hover:text-red-600 text-xs"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <AlertCircle className="h-4 w-4 text-red-500 mr-2" />
              <span className="text-sm text-red-700 dark:text-red-300">
                {error}
              </span>
            </div>
            <button
              onClick={refetch}
              disabled={isLoading}
              className="text-red-600 dark:text-red-400 hover:text-red-700 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
      )}

      {/* Tab header */}
      <div className="border-b border-zinc-200 dark:border-zinc-700">
        <nav className="flex">
          {workflowTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const hasContent = tabStatus[tab.id];
            const TabIcon = tab.icon;
            // Show badge for plan tab awaiting approval
            const needsAttention =
              tab.id === 'plan' &&
              effectiveStatus === 'plan_created' &&
              hasContent;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2 py-3 px-5 border-b-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300'
                }`}
              >
                <TabIcon className="h-4 w-4" />
                <span>{tab.label}</span>
                {needsAttention ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-800/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium rounded-full">
                    <Clock className="h-2.5 w-2.5" />
                    承認待ち
                  </span>
                ) : (
                  <div
                    className={`w-2 h-2 rounded-full ${
                      hasContent
                        ? 'bg-green-500'
                        : 'bg-zinc-300 dark:bg-zinc-600'
                    }`}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content area */}
      <div className="p-5">
        {isLoading && !files ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-5 w-5 text-zinc-400 animate-spin mr-2" />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              読み込み中...
            </span>
          </div>
        ) : activeFile?.exists ? (
          <div className="space-y-3">
            {/* File information */}
            <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 pb-2 border-b border-zinc-100 dark:border-zinc-700/50">
              <span>
                更新:{' '}
                {activeFile.lastModified
                  ? new Date(activeFile.lastModified).toLocaleString('ja-JP')
                  : '不明'}
              </span>
              <div className="flex items-center gap-3">
                <span>
                  {activeFile.size
                    ? `${(activeFile.size / 1024).toFixed(1)}KB`
                    : ''}
                </span>
                <button
                  onClick={refetch}
                  disabled={isLoading}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  title="再読み込み"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
                  />
                </button>
              </div>
            </div>

            {/* Markdown content */}
            <div className="prose dark:prose-invert max-w-none prose-sm prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100 prose-p:text-zinc-700 dark:prose-p:text-zinc-300">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  input: ({ type, checked, ...props }) => {
                    if (type === 'checkbox') {
                      return (
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled
                          className="mr-2 accent-indigo-600"
                          {...props}
                        />
                      );
                    }
                    return <input type={type} {...props} />;
                  },
                  code: ({ className: codeClassName, children, ...props }) => (
                    <code
                      className={`${codeClassName || ''} bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-sm`}
                      {...props}
                    >
                      {children}
                    </code>
                  ),
                }}
              >
                {activeFile.content || ''}
              </ReactMarkdown>
            </div>

            {/* Plan approval button */}
            {showApprovalButton && (
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
                  <div>
                    <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                      計画の承認が必要です
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      内容を確認して承認すると実装フェーズに移行します
                    </p>
                  </div>
                  <button
                    onClick={onPlanApprovalRequest}
                    className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    承認して実装開始
                  </button>
                </div>
              </div>
            )}

            {/* Implementation complete button */}
            {showCompleteButton && (
              <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
                <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                  <div>
                    <p className="text-sm font-medium text-green-900 dark:text-green-200">
                      検証レポートの確認
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                      実装と検証が完了していればタスクを完了にします
                    </p>
                  </div>
                  <button
                    onClick={onCompleteRequest}
                    className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                  >
                    実装完了
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* File not created state */
          <div className="text-center py-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3">
              <activeTabConfig.icon className="h-6 w-6 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {activeTabConfig.emptyText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
