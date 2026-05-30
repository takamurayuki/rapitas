'use client';
import { useState, useEffect } from 'react';
import { Coffee, Pause, Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import GlobalPomodoroModal from './GlobalPomodoroModal';
import {
  usePomodoroStore,
  formatTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
  type PomodoroState,
} from './pomodoro-store';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GlobalPomodoroWidget');

export default function GlobalPomodoroWidget() {
  const t = useTranslations('pomodoro');
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  // NOTE: null during SSR, only read state on client side
  const [state, setState] = useState<Partial<PomodoroState> | null>(null);

  const stopTimer = usePomodoroStore((s) => s.stopTimer);

  // Only monitor state on client side
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);

    const updateState = (store: PomodoroState) => {
      setState({
        _hasHydrated: store._hasHydrated,
        isTimerRunning: store.isTimerRunning,
        isPaused: store.isPaused,
        isBreakTime: store.isBreakTime,
        taskId: store.taskId,
        taskTitle: store.taskTitle,
        pomodoroCount: store.pomodoroCount,
        pomodoroSeconds: store.pomodoroSeconds,
        settings: store.settings,
      });
    };

    // Set initial values
    updateState(usePomodoroStore.getState());

    // Monitor changes
    const unsubscribe = usePomodoroStore.subscribe(updateState);

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // NOTE: All hooks must be placed before conditional returns
  useEffect(() => {
    if (!state?._hasHydrated || !state?.isTimerRunning || !state?.taskId) return;

    const controller = new AbortController();

    const checkTaskExists = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${state.taskId}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          // Stop timer if task not found
          logger.info('Task not found, stopping timer');
          stopTimer();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Don't stop timer on network errors
        logger.warn('Failed to check task existence:', err);
      }
    };

    // Initial check
    checkTaskExists();

    // Check every 30 seconds
    const intervalId = setInterval(checkTaskExists, 30000);

    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [state?._hasHydrated, state?.isTimerRunning, state?.taskId, stopTimer]);

  // NOTE: Render nothing before mount or when state is unset (hydration safety)
  if (!mounted || !state) return null;

  const {
    _hasHydrated,
    isTimerRunning,
    isPaused,
    isBreakTime,
    taskId,
    taskTitle,
    pomodoroCount,
    pomodoroSeconds,
    settings,
  } = state;

  // NOTE: Render nothing until hydration completes
  if (!_hasHydrated) return null;

  if (!isTimerRunning) return null;

  // Calculate remaining time
  const getRemainingTimeLocal = () => {
    const pomodoroDuration = settings?.pomodoroDuration || DEFAULT_POMODORO_DURATION;
    const shortBreakDuration = settings?.shortBreakDuration || DEFAULT_SHORT_BREAK;
    const longBreakDuration = settings?.longBreakDuration || DEFAULT_LONG_BREAK;

    if (isBreakTime) {
      const breakDuration = (pomodoroCount || 0) % 4 === 0 ? longBreakDuration : shortBreakDuration;
      return breakDuration - (pomodoroSeconds || 0);
    }
    return pomodoroDuration - (pomodoroSeconds || 0);
  };

  const remainingTime = getRemainingTimeLocal();

  // Icon mirrors TaskPomodoroButton — no colour class, inherits the button text
  // colour so the two pomodoro displays look identical.
  const getIcon = () => {
    if (isBreakTime) {
      return <Coffee className="w-4 h-4" />;
    } else if (isPaused) {
      return <Pause className="w-4 h-4" />;
    } else {
      return <Hourglass className="w-4 h-4 animate-pulse" />;
    }
  };

  // Flat (borderless) state-tinted style, matching TaskPomodoroButton.
  const getButtonStyle = () => {
    const base =
      'flex items-center gap-2 px-3 py-2 text-xs font-black font-mono tracking-tight rounded-lg transition-colors text-zinc-700 dark:text-zinc-300';
    if (isBreakTime) {
      return `${base} bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900`;
    } else if (isPaused) {
      return `${base} bg-orange-50 dark:bg-orange-950 hover:bg-orange-100 dark:hover:bg-orange-900`;
    }
    return `${base} bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900`;
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={getButtonStyle()}
        title={`${taskTitle} - ${t('timeManagement')}`}
      >
        {getIcon()}
        <span>{t('timeManagement')}</span>
        <span className="text-xs font-mono tabular-nums">{formatTime(remainingTime)}</span>
      </button>
      <GlobalPomodoroModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </>
  );
}
