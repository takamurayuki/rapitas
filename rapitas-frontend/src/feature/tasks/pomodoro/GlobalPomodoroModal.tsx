"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Timer, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import PomodoroTimer from "@/feature/tasks/components/pomodoro-timer";
import { usePomodoroStore } from "./pomodoroStore";
import { TimeEntry } from "@/types";

interface GlobalPomodoroModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function GlobalPomodoroModal({
  isOpen,
  onClose,
}: GlobalPomodoroModalProps) {
  const state = usePomodoroStore();
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [taskData, setTaskData] = useState<{
    estimatedHours?: number;
    actualHours?: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  // クライアントサイドでのみportalをマウント
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // タスクのtime entriesとタスクデータを取得
  useEffect(() => {
    if (state.taskId && isOpen) {
      fetch(`${API_BASE}/tasks/${state.taskId}/time-entries`)
        .then((res) => {
          if (!res.ok) return [];
          return res.json();
        })
        .then((data) => setTimeEntries(data))
        .catch((err) => console.error("Failed to fetch time entries:", err));

      fetch(`${API_BASE}/tasks/${state.taskId}`)
        .then((res) => {
          if (!res.ok) {
            // タスクが見つからない場合はタイマーを停止してモーダルを閉じる
            console.log("Task not found, stopping timer");
            state.stopTimer();
            onClose();
            return null;
          }
          return res.json();
        })
        .then((data) => {
          if (data) {
            setTaskData({
              estimatedHours: data.estimatedHours,
              actualHours: data.actualHours,
            });
          }
        })
        .catch((err) => console.error("Failed to fetch task:", err));
    }
  }, [state.taskId, isOpen, state.stopTimer, onClose]);

  if (!isOpen) return null;
  if (!state.isTimerRunning || !state.taskId || !state.taskTitle) return null;
  if (!mounted) return null;

  const handleUpdate = () => {
    if (state.taskId) {
      fetch(`${API_BASE}/tasks/${state.taskId}/time-entries`)
        .then((res) => {
          if (!res.ok) return [];
          return res.json();
        })
        .then((data) => setTimeEntries(data))
        .catch((err) => console.error("Failed to fetch time entries:", err));

      fetch(`${API_BASE}/tasks/${state.taskId}`)
        .then((res) => {
          if (!res.ok) {
            // タスクが見つからない場合はタイマーを停止してモーダルを閉じる
            console.log("Task not found, stopping timer");
            state.stopTimer();
            onClose();
            return null;
          }
          return res.json();
        })
        .then((data) => {
          if (data) {
            setTaskData({
              estimatedHours: data.estimatedHours,
              actualHours: data.actualHours,
            });
          }
        })
        .catch((err) => console.error("Failed to fetch task:", err));
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <Timer className="w-5 h-5 text-blue-500 shrink-0" />
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
              時間管理
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
            title="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* タスク名 */}
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-b border-zinc-200 dark:border-zinc-800">
          <Link
            href={`/tasks/${state.taskId}`}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1.5 min-w-0"
            onClick={onClose}
          >
            <span className="truncate">{state.taskTitle}</span>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          </Link>
        </div>

        {/* タイマー */}
        <div className="p-4">
          <PomodoroTimer
            taskId={state.taskId}
            taskTitle={state.taskTitle}
            showTaskTitle={false}
            estimatedHours={taskData?.estimatedHours}
            actualHours={taskData?.actualHours}
            timeEntries={timeEntries}
            onUpdate={handleUpdate}
          />
        </div>
      </div>
    </div>
  );

  // document.bodyにPortalでレンダリングしてHeaderのz-indexから独立させる
  return createPortal(modalContent, document.body);
}
