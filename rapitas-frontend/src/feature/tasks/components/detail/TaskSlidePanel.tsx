'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Columns2 } from 'lucide-react';
import TaskDetailClient from '@/app/tasks/[id]/TaskDetailClient';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { useTerminalStore } from '@/feature/terminal/terminal-store';

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
  const {
    showTaskDetail,
    hideTaskDetail,
    dockSide,
    toggleDockSide,
    displayMode,
    toggleDisplayMode,
  } = useTaskDetailVisibilityStore();
  const isSplit = displayMode === 'split';

  // When the integrated terminal is split-docked on the same edge, tile beside
  // it instead of covering it (mirrors AppContent, which sums both widths).
  const terminalIsOpen = useTerminalStore((s) => s.isOpen);
  const terminalDisplayMode = useTerminalStore((s) => s.displayMode);
  const terminalDockSide = useTerminalStore((s) => s.dockSide);
  const terminalSplitWidthPercent = useTerminalStore((s) => s.splitWidthPercent);
  const terminalHasTabs = useTerminalStore((s) => s.tabs.length > 0);
  const sameSideTerminalVw =
    isSplit &&
    terminalIsOpen &&
    terminalDisplayMode === 'split' &&
    terminalHasTabs &&
    terminalDockSide === dockSide
      ? terminalSplitWidthPercent
      : 0;

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

  // Disable body scroll while the panel floats as an overlay. Split mode must
  // NOT lock it — the whole point is that the page stays usable alongside.
  useEffect(() => {
    if (isVisible && !isSplit) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isVisible, isSplit]);

  if (!isVisible || !taskId) return null;

  const isClosing = isAnimatingOut;
  // Explicit per-direction keyframes (not a --custom-property read inside a
  // shared pair) — browsers can't reliably tween `transform` through an
  // unregistered CSS custom property, which flickered/jumped instead of
  // sliding smoothly. Literal from/to percentages animate correctly.
  const slideInAnim = dockSide === 'right' ? 'taskPanelSlideInRight' : 'taskPanelSlideInLeft';
  const slideOutAnim = dockSide === 'right' ? 'taskPanelSlideOutRight' : 'taskPanelSlideOutLeft';

  return (
    <>
      {/* Overlay — sits below the header (top-16) so the header stays visible
          and interactive, matching the side nav's backdrop. z-[65] (above the
          split-mode terminal panel's z-60) so the terminal dims along with
          the rest of the page instead of poking out on top of the overlay.
          Split mode renders no overlay at all — the page must stay clickable. */}
      {!isSplit && (
        <div
          className="fixed inset-x-0 top-16 bottom-0 z-[65]"
          onClick={handleClose}
          style={{
            animation: isClosing
              ? `fadeOut ${ANIMATION_DURATION}ms ease-in forwards`
              : `fadeIn ${ANIMATION_DURATION}ms ease-out forwards`,
          }}
        />
      )}

      {/* Slide panel — positioned below the header (top-16) like the side nav,
          so it no longer overlaps the sticky header. z-[70] (above the overlay
          and the terminal panel's z-60) so the terminal's split mode can
          never hide it — the task panel always wins that stacking fight.
          Split mode: fixed 50vw wide (must match TASK_DETAIL_SPLIT_WIDTH_VW —
          AppContent reserves the same as page padding). */}
      <div
        className={`fixed top-16 bottom-0 ${dockSide === 'right' ? 'right-0' : 'left-0'} ${
          isSplit ? 'w-full md:w-[50vw]' : 'w-full md:w-3/4 lg:w-2/3 xl:w-1/2'
        } flex flex-col bg-white dark:bg-zinc-950 shadow-2xl z-[70] overflow-hidden`}
        style={{
          animation: isClosing
            ? `${slideOutAnim} ${ANIMATION_DURATION}ms ease-in forwards`
            : `${slideInAnim} ${ANIMATION_DURATION}ms ease-out forwards`,
          // Slide over past the same-side split terminal instead of under it.
          ...(sameSideTerminalVw ? { [dockSide]: `${sameSideTerminalVw}vw` } : {}),
        }}
      >
        {/* Header (compact) */}
        <div className="shrink-0 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-indigo-dark-900 px-4 py-2.5">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => toggleDisplayMode()}
              className={`p-1.5 rounded-lg transition-colors ${
                isSplit
                  ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30'
                  : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
              title={isSplit ? t('overlayView') : t('splitView')}
              aria-label={t('toggleSplitAria')}
              aria-pressed={isSplit}
            >
              <Columns2 className="w-4 h-4" aria-hidden="true" />
            </button>
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
           Four explicit keyframes (not two parameterized by a CSS custom
           property) — a translateX(var(--x)) keyframe flickered/jumped
           instead of tweening smoothly, since browsers can't reliably
           interpolate transform through an unregistered custom property.
           Literal from/to percentages per direction animate correctly. */
        @keyframes taskPanelSlideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes taskPanelSlideOutRight {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
        @keyframes taskPanelSlideInLeft {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes taskPanelSlideOutLeft {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-100%);
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
