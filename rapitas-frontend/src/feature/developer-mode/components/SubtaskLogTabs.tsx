"use client";

import { useState, useMemo } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  Clock,
  Pause,
  Terminal,
  RefreshCw,
} from "lucide-react";
import type { Task } from "@/types";
import type { ParallelExecutionStatus } from "@/feature/tasks/components/SubtaskExecutionStatus";
import { ExecutionLogViewer, type ExecutionLogStatus } from "./ExecutionLogViewer";

interface SubtaskLogTabsProps {
  /** サブタスクのリスト */
  subtasks: Task[];
  /** サブタスクのステータスを取得する関数 */
  getSubtaskStatus?: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** サブタスクごとのログ */
  subtaskLogs: Map<number, { logs: Array<{ timestamp: string; message: string; level: string }> }>;
  /** 全体の実行中かどうか */
  isRunning: boolean;
  /** ログを更新する関数 */
  onRefreshLogs?: (taskId?: number) => void;
  /** 最大高さ */
  maxHeight?: number;
}

/**
 * サブタスク実行ログのタブ表示コンポーネント
 */
export function SubtaskLogTabs({
  subtasks,
  getSubtaskStatus,
  subtaskLogs,
  isRunning,
  onRefreshLogs,
  maxHeight = 200,
}: SubtaskLogTabsProps) {
  // 「全体」タブ + サブタスクタブ
  const [activeTab, setActiveTab] = useState<number | "all">("all");

  // ステータスに応じたアイコンを取得
  const getStatusIcon = (status?: ParallelExecutionStatus) => {
    const iconClass = "w-3 h-3";
    switch (status) {
      case "running":
        return <Loader2 className={`${iconClass} text-blue-500 animate-spin`} />;
      case "completed":
        return <CheckCircle2 className={`${iconClass} text-green-500`} />;
      case "failed":
        return <XCircle className={`${iconClass} text-red-500`} />;
      case "scheduled":
        return <Clock className={`${iconClass} text-blue-400`} />;
      case "blocked":
        return <Pause className={`${iconClass} text-orange-500`} />;
      case "cancelled":
        return <Pause className={`${iconClass} text-yellow-500`} />;
      case "pending":
      default:
        return <Circle className={`${iconClass} text-zinc-400`} />;
    }
  };

  // 全体のログを統合
  const allLogs = useMemo(() => {
    const logs: Array<{ timestamp: string; message: string; level: string; taskId?: number }> = [];
    subtaskLogs.forEach((state, taskId) => {
      state.logs.forEach((log) => {
        logs.push({ ...log, taskId });
      });
    });
    // タイムスタンプでソート
    return logs.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [subtaskLogs]);

  // 現在選択されているタブのログ
  const currentLogs = useMemo((): Array<{ timestamp: string; message: string; level: string; taskId?: number }> => {
    if (activeTab === "all") {
      return allLogs;
    }
    const subtaskLog = subtaskLogs.get(activeTab);
    // 単一サブタスクのログにもtaskIdを追加
    return (subtaskLog?.logs || []).map((log) => ({ ...log, taskId: activeTab as number }));
  }, [activeTab, allLogs, subtaskLogs]);

  // ExecutionLogViewer用のログ形式に変換
  const formattedLogs = useMemo(() => {
    return currentLogs.map((log) => {
      const subtask = log.taskId ? subtasks.find((s) => s.id === log.taskId) : undefined;
      const prefix = activeTab === "all" && subtask ? `[${subtask.title}] ` : "";
      return `${prefix}${log.message}`;
    });
  }, [currentLogs, activeTab, subtasks]);

  // 全体のステータスを計算
  const overallStatus: ExecutionLogStatus = useMemo(() => {
    if (isRunning) return "running";

    let hasCompleted = false;
    let hasFailed = false;

    subtasks.forEach((subtask) => {
      const status = getSubtaskStatus?.(subtask.id);
      if (status === "completed") hasCompleted = true;
      if (status === "failed") hasFailed = true;
    });

    if (hasFailed) return "failed";
    if (hasCompleted && !isRunning) return "completed";
    return "idle";
  }, [isRunning, subtasks, getSubtaskStatus]);

  // タブのステータスを取得
  const getTabStatus = (taskId: number): ExecutionLogStatus => {
    const status = getSubtaskStatus?.(taskId);
    switch (status) {
      case "running":
        return "running";
      case "completed":
        return "completed";
      case "failed":
        return "failed";
      case "cancelled":
        return "cancelled";
      default:
        return "idle";
    }
  };

  if (subtasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {/* タブヘッダー */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
        {/* 全体タブ */}
        <button
          onClick={() => setActiveTab("all")}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
            activeTab === "all"
              ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-500"
              : "bg-zinc-50 dark:bg-indigo-dark-800/50 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <Terminal className="w-3 h-3" />
          <span>全体</span>
          {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
          <span className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[9px]">
            {allLogs.length}
          </span>
        </button>

        {/* サブタスクタブ */}
        {subtasks.map((subtask) => {
          const status = getSubtaskStatus?.(subtask.id);
          const logs = subtaskLogs.get(subtask.id)?.logs || [];
          const isActive = activeTab === subtask.id;

          return (
            <button
              key={subtask.id}
              onClick={() => setActiveTab(subtask.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 max-w-[150px] ${
                isActive
                  ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-500"
                  : "bg-zinc-50 dark:bg-indigo-dark-800/50 text-zinc-600 dark:text-zinc-400 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              title={subtask.title}
            >
              {getStatusIcon(status)}
              <span className="truncate">{subtask.title}</span>
              {logs.length > 0 && (
                <span className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[9px] shrink-0">
                  {logs.length}
                </span>
              )}
            </button>
          );
        })}

        {/* 更新ボタン */}
        {onRefreshLogs && (
          <button
            onClick={() => onRefreshLogs(activeTab === "all" ? undefined : activeTab)}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors shrink-0 ml-auto"
            title="ログを更新"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* ログ表示エリア */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {formattedLogs.length > 0 ? (
          <ExecutionLogViewer
            logs={formattedLogs}
            status={activeTab === "all" ? overallStatus : getTabStatus(activeTab as number)}
            isRunning={
              activeTab === "all"
                ? isRunning
                : getSubtaskStatus?.(activeTab as number) === "running"
            }
            collapsible={false}
            maxHeight={maxHeight}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-zinc-400 dark:text-zinc-500">
            <Terminal className="w-6 h-6 mb-2 opacity-50" />
            <p className="text-[10px]">
              {isRunning ? "ログを待機中..." : "ログがありません"}
            </p>
          </div>
        )}
      </div>

      {/* サブタスク進捗サマリー */}
      <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span>進捗:</span>
        {subtasks.map((subtask) => {
          const status = getSubtaskStatus?.(subtask.id);
          return (
            <div
              key={subtask.id}
              className="flex items-center gap-0.5"
              title={`${subtask.title}: ${status || "pending"}`}
            >
              {getStatusIcon(status)}
            </div>
          );
        })}
        <span className="ml-auto">
          {subtasks.filter((s) => getSubtaskStatus?.(s.id) === "completed").length}
          /{subtasks.length} 完了
        </span>
      </div>
    </div>
  );
}

export default SubtaskLogTabs;
