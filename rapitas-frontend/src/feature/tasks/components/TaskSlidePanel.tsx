'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import TaskDetailClient from '@/app/tasks/[id]/TaskDetailClient';
import TaskDetailSkeleton from '@/components/ui/skeleton/TaskDetailSkeleton';
import { useTaskDetailVisibilityStore } from '@/stores/taskDetailVisibilityStore';

interface TaskSlidePanelProps {
  taskId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated?: () => void;
}

const ANIMATION_DURATION = 300;

export default function TaskSlidePanel({
  taskId,
  isOpen,
  onClose,
  onTaskUpdated,
}: TaskSlidePanelProps) {
  // Keep DOM mounted until close animation completes
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Task detail visibility store
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();

  // When opening: set isVisible to true & reset scroll position
  useEffect(() => {
    if (isOpen && taskId) {
      // Notify store that task detail is being shown
      showTaskDetail();

      // Set on next render cycle
      const timer = setTimeout(() => {
        setIsAnimatingOut(false);
        setIsVisible(true);
      }, 0);

      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
        closingTimerRef.current = null;
      }

      // Reset scroll position to top when panel opens
      requestAnimationFrame(() => {
        if (contentRef.current) {
          contentRef.current.scrollTop = 0;
        }
      });

      return () => clearTimeout(timer);
    }
  }, [isOpen, taskId, showTaskDetail]);

  // When closing: set isVisible to false after animation completes
  useEffect(() => {
    if (!isOpen && isVisible && !isAnimatingOut) {
      // Set on next render cycle
      const timer = setTimeout(() => setIsAnimatingOut(true), 0);
      closingTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        setIsAnimatingOut(false);
        closingTimerRef.current = null;
        // Notify store that task detail is being hidden
        hideTaskDetail();
      }, ANIMATION_DURATION);

      return () => clearTimeout(timer);
    }
  }, [isOpen, isVisible, isAnimatingOut, hideTaskDetail]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (closingTimerRef.current) {
        clearTimeout(closingTimerRef.current);
      }
    };
  }, []);

  // Close on Escape key
  const handleClose = useCallback(() => {
    if (!isAnimatingOut) {
      onClose();
    }
  }, [onClose, isAnimatingOut]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isVisible) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isVisible, handleClose]);

  // Disable body scroll while panel is visible
  useEffect(() => {
    if (isVisible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isVisible]);

  if (!isVisible || !taskId) return null;

  const isClosing = isAnimatingOut;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        onClick={handleClose}
        style={{
          animation: isClosing
            ? `fadeOut ${ANIMATION_DURATION}ms ease-in forwards`
            : `fadeIn ${ANIMATION_DURATION}ms ease-out forwards`,
        }}
      />

      {/* Slide panel */}
      <div
        className="fixed top-0 right-0 h-full w-full md:w-3/4 lg:w-2/3 xl:w-1/2 bg-white dark:bg-zinc-950 shadow-2xl z-50 overflow-hidden"
        style={{
          animation: isClosing
            ? `slideOut ${ANIMATION_DURATION}ms ease-in forwards`
            : `slideIn ${ANIMATION_DURATION}ms ease-out forwards`,
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-indigo-dark-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            タスク詳細
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
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

        {/* Content */}
        <div ref={contentRef} className="h-full overflow-y-auto pb-16">
          <TaskDetailClient
            taskId={taskId}
            onTaskUpdated={onTaskUpdated}
            onClose={handleClose}
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
