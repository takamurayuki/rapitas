"use client";
import { useEffect } from "react";
import TaskDetailClient from "@/app/tasks/[id]/TaskDetailClient";

interface TaskSlidePanelProps {
  taskId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}

export default function TaskSlidePanel({
  taskId,
  isOpen,
  onClose,
  onTaskUpdated,
}: TaskSlidePanelProps) {
  // Escキーで閉じる
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // パネルが開いたときにスクロールを無効化
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen || !taskId) return null;

  return (
    <>
      {/* オーバーレイ */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        style={{ animation: isOpen ? "fadeIn 0.3s" : "fadeOut 0.3s" }}
      />

      {/* スライドパネル */}
      <div
        className="fixed top-0 right-0 h-full w-full md:w-3/4 lg:w-2/3 xl:w-1/2 bg-white dark:bg-zinc-950 shadow-2xl z-50 overflow-hidden"
        style={{
          animation: isOpen ? "slideIn 0.3s ease-out" : "slideOut 0.3s ease-in",
        }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white dark:bg-indigo-dark-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            タスク詳細
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title="閉じる (Esc)"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="h-full overflow-y-auto pb-16">
          <TaskDetailClient
            taskId={taskId}
            onTaskUpdated={onTaskUpdated}
            onClose={onClose}
          />
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
      `}</style>
    </>
  );
}
