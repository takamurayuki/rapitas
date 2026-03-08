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
  PomodoroState,
} from './pomodoroStore';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('GlobalPomodoroWidget');

export default function GlobalPomodoroWidget() {
  const t = useTranslations('pomodoro');
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  // SSR時はnull、クライアントサイドでのみ状態を読み込む
  const [state, setState] = useState<Partial<PomodoroState> | null>(null);

  const stopTimer = usePomodoroStore((s) => s.stopTimer);

  // クライアントサイドでのみ状態を監視
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

    // 初期値を設定
    updateState(usePomodoroStore.getState());

    // 変更を監視
    const unsubscribe = usePomodoroStore.subscribe(updateState);

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  // タスクが削除されていないか定期的に確認（全てのhookは条件付きreturnの前に配置）
  useEffect(() => {
    if (!state?._hasHydrated || !state?.isTimerRunning || !state?.taskId)
      return;

    const controller = new AbortController();

    const checkTaskExists = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/${state.taskId}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          // タスクが見つからない場合はタイマーを停止
          logger.info('Task not found, stopping timer');
          stopTimer();
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // ネットワークエラーなどの場合はタイマーを停止しない
        logger.warn('Failed to check task existence:', err);
      }
    };

    // 初回チェック
    checkTaskExists();

    // 30秒ごとにチェック
    const intervalId = setInterval(checkTaskExists, 30000);

    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, [state?._hasHydrated, state?.isTimerRunning, state?.taskId, stopTimer]);

  // マウント前またはstate未設定の場合は何も表示しない（Hydration対策）
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

  // Hydration完了まで何も表示しない
  if (!_hasHydrated) return null;

  // タイマーが動いていない場合は何も表示しない
  if (!isTimerRunning) return null;

  // 残り時間を計算
  const getRemainingTimeLocal = () => {
    const pomodoroDuration =
      settings?.pomodoroDuration || DEFAULT_POMODORO_DURATION;
    const shortBreakDuration =
      settings?.shortBreakDuration || DEFAULT_SHORT_BREAK;
    const longBreakDuration = settings?.longBreakDuration || DEFAULT_LONG_BREAK;

    if (isBreakTime) {
      const breakDuration =
        (pomodoroCount || 0) % 4 === 0 ? longBreakDuration : shortBreakDuration;
      return breakDuration - (pomodoroSeconds || 0);
    }
    return pomodoroDuration - (pomodoroSeconds || 0);
  };

  const remainingTime = getRemainingTimeLocal();

  // 現在のステータスに基づいてアイコンを選択
  const getIcon = () => {
    if (isBreakTime) {
      return <Coffee className="w-4 h-4 text-green-500" />;
    } else if (isPaused) {
      return <Pause className="w-4 h-4 text-orange-500" />;
    } else {
      return <Hourglass className="w-4 h-4 text-blue-500 animate-pulse" />;
    }
  };

  // ステータスに基づいてスタイルを決定
  const getButtonStyle = () => {
    if (isBreakTime) {
      return 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700';
    } else if (isPaused) {
      return 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700';
    }
    // 作業中（アクティブ）状態
    return 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700';
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${getButtonStyle()}`}
        title={`${taskTitle} - ${t('timeManagement')}`}
      >
        {getIcon()}
        <span>{t('timeManagement')}</span>
        <span className="text-xs font-mono tabular-nums">
          {formatTime(remainingTime)}
        </span>
      </button>
      <GlobalPomodoroModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}
