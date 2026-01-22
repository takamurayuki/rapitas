"use client";
import { useState, useEffect } from "react";
import { Coffee, Pause, Hourglass } from "lucide-react";
import GlobalPomodoroModal from "./GlobalPomodoroModal";
import {
  usePomodoroStore,
  formatTime,
  POMODORO_DURATION,
  SHORT_BREAK,
  LONG_BREAK,
  PomodoroState,
} from "./pomodoroStore";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function GlobalPomodoroWidget() {
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  // SSR時はnull、クライアントサイドでのみ状態を読み込む
  const [state, setState] = useState<Partial<PomodoroState> | null>(null);

  const stopTimer = usePomodoroStore((s) => s.stopTimer);

  // クライアントサイドでのみ状態を監視
  useEffect(() => {
    setMounted(true);

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
      });
    };

    // 初期値を設定
    updateState(usePomodoroStore.getState());

    // 変更を監視
    const unsubscribe = usePomodoroStore.subscribe(updateState);

    return () => unsubscribe();
  }, []);

  // タスクが削除されていないか定期的に確認（全てのhookは条件付きreturnの前に配置）
  useEffect(() => {
    if (!state?._hasHydrated || !state?.isTimerRunning || !state?.taskId) return;

    const checkTaskExists = async () => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${state.taskId}`);
        if (!res.ok) {
          // タスクが見つからない場合はタイマーを停止
          console.log("Task not found, stopping timer");
          stopTimer();
        }
      } catch (err) {
        // ネットワークエラーなどの場合はタイマーを停止しない
        console.error("Failed to check task existence:", err);
      }
    };

    // 初回チェック
    checkTaskExists();

    // 30秒ごとにチェック
    const intervalId = setInterval(checkTaskExists, 30000);

    return () => clearInterval(intervalId);
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
  } = state;

  // Hydration完了まで何も表示しない
  if (!_hasHydrated) return null;

  // タイマーが動いていない場合は何も表示しない
  if (!isTimerRunning) return null;

  // 残り時間を計算
  const getRemainingTimeLocal = () => {
    if (isBreakTime) {
      const breakDuration = (pomodoroCount || 0) % 4 === 0 ? LONG_BREAK : SHORT_BREAK;
      return breakDuration - (pomodoroSeconds || 0);
    }
    return POMODORO_DURATION - (pomodoroSeconds || 0);
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
      return "bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700";
    } else if (isPaused) {
      return "bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700";
    }
    // 作業中（アクティブ）状態
    return "bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700";
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${getButtonStyle()}`}
        title={`${taskTitle} - 時間管理`}
      >
        {getIcon()}
        <span>時間管理</span>
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
