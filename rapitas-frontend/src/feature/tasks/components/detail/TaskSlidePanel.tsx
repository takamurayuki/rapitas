'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight } from 'lucide-react';
import TaskDetailClient from '@/app/tasks/[id]/TaskDetailClient';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';

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
  const t = useTranslations('task.taskSlidePanel');
  // Keep DOM mounted until close animation completes
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Task detail visibility store
  const { showTaskDetail, hideTaskDetail, dockSide, toggleDockSide } =
    useTaskDetailVisibilityStore();

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
  // Read by the two @keyframes below (transform: translateX(var(...))) so a
  // single slide-in/slide-out pair covers both dock sides — only the offset
  // it animates from/to changes, not the animation name itself.
  const slideOffset = dockSide === 'right' ? '100%' : '-100%';

  return (
    <>
      {/* Overlay — sits below the header (top-16) so the header stays visible
          and interactive, matching the side nav's backdrop. z-[65] (above the
          split-mode terminal panel's z-60) so the terminal dims along with
          the rest of the page instead of poking out on top of the overlay. */}
      <div
        className="fixed inset-x-0 top-16 bottom-0 z-[65]"
        onClick={handleClose}
        style={{
          animation: isClosing
            ? `fadeOut ${ANIMATION_DURATION}ms ease-in forwards`
            : `fadeIn ${ANIMATION_DURATION}ms ease-out forwards`,
        }}
      />

      {/* Slide panel — positioned below the header (top-16) like the side nav,
          so it no longer overlaps the sticky header. z-[70] (above the overlay
          and the terminal panel's z-60) so the terminal's split mode can
          never hide it — the task panel always wins that stacking fight. */}
      <div
        className={`fixed top-16 bottom-0 ${dockSide === 'right' ? 'right-0' : 'left-0'} w-full md:w-3/4 lg:w-2/3 xl:w-1/2 flex flex-col bg-white dark:bg-zinc-950 shadow-2xl z-[70] overflow-hidden`}
        style={
          {
            '--task-panel-slide-offset': slideOffset,
            animation: isClosing
              ? `taskPanelSlideOut ${ANIMATION_DURATION}ms ease-in forwards`
              : `taskPanelSlideIn ${ANIMATION_DURATION}ms ease-out forwards`,
          } as CSSProperties
        }
      >
        {/* Header (compact) */}
        <div className="shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 px-4 py-2.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleDockSide()}
              className="p-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title={dockSide === 'right' ? t('dockLeft') : t('dockRight')}
              aria-label={t('swapDockSideAria')}
            >
              <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              onClick={handleClose}
              className="p-1.5 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              title={t('closeTooltip')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

        {/* Content — single scroll container (TaskDetailContent flows inside).
            Marked so the quick-nav scroll-spy can resolve it deterministically.
            scrollbar-thin: hover-only thin scrollbar like the rest of the app —
            the default OS scrollbar looked oversized in the side panel. */}
        <div
          ref={contentRef}
          data-task-scroll-container
          className="flex-1 min-h-0 overflow-y-auto scrollbar-thin"
        >
          <TaskDetailClient taskId={taskId} onTaskUpdated={onTaskUpdated} onClose={handleClose} />
        </div>
      </div>

      <style>{`
        /* NOTE: named taskPanel* (not slideIn/slideOut) — globals.css already
           defines global @keyframes slideIn/slideOut for NoteHoverSidebar with
           different values (a left-only slide + opacity fade); CSS keyframes
           are global by name regardless of being declared in a component
           <style> tag, so reusing those names here would silently pick up
           whichever declaration the browser resolves last.
           One pair covers both dock sides via the --task-panel-slide-offset
           custom property set inline on the panel (100% right-docked, -100%
           left-docked) — the animation NAME itself never changes with
           dockSide, only the value it reads, which keeps the inline
           style.animation string constant per open/close state. */
        @keyframes taskPanelSlideIn {
          from {
            transform: translateX(var(--task-panel-slide-offset));
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes taskPanelSlideOut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(var(--task-panel-slide-offset));
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
