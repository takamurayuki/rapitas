"use client";
import { TimeEntry } from "@/types";
import { useState, useEffect, useRef } from "react";
import {
  Icon,
  Circle,
  Play,
  Pause,
  Square,
  Timer,
  Coffee,
  Hourglass,
} from "lucide-react";

import { fruit } from "@lucide/lab";

export type PomodoroStatus = {
  isRunning: boolean;
  isPaused: boolean;
  isBreak: boolean;
  pomodoroCount: number;
  remainingSeconds: number;
};

interface PomodoroTimerProps {
  taskId: number;
  estimatedHours?: number;
  actualHours?: number;
  timeEntries: TimeEntry[];
  onUpdate: () => void;
  onStatusChange?: (status: PomodoroStatus) => void;
}

const POMODORO_DURATION = 25 * 60; // 25分
const SHORT_BREAK = 5 * 60; // 5分
const LONG_BREAK = 15 * 60; // 15分

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function PomodoroTimer({
  taskId,
  estimatedHours,
  actualHours,
  timeEntries,
  onUpdate,
  onStatusChange,
}: PomodoroTimerProps) {
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [timerStartTime, setTimerStartTime] = useState<Date | null>(null);
  const [pausedElapsedSeconds, setPausedElapsedSeconds] = useState(0); // 一時停止時の累積時間
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [workSeconds, setWorkSeconds] = useState(0); // 実作業時間（休憩を除く）
  const [pausedWorkSeconds, setPausedWorkSeconds] = useState(0); // 一時停止時の実作業時間

  // ポモドーロ関連
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [pausedPomodoroSeconds, setPausedPomodoroSeconds] = useState(0); // 一時停止時のポモドーロ秒数
  const [isBreakTime, setIsBreakTime] = useState(false);
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [accumulatedBreakSeconds, setAccumulatedBreakSeconds] = useState(0);

  // ダイアログ
  const [showBreakDialog, setShowBreakDialog] = useState(false);
  const [showBreakEndDialog, setShowBreakEndDialog] = useState(false);
  const [showOverageDialog, setShowOverageDialog] = useState(false);
  const [overageReason, setOverageReason] = useState("");

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const workAudioRef = useRef<HTMLAudioElement | null>(null);
  const breakAudioRef = useRef<HTMLAudioElement | null>(null);
  const [hasWorkAudio, setHasWorkAudio] = useState(false);
  const [hasBreakAudio, setHasBreakAudio] = useState(false);

  // 音声ファイルの存在チェック
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 25分経過用の音声ファイルをチェック
    const workAudio = new Audio("/notification-work.mp3");
    workAudio.addEventListener("canplaythrough", () => setHasWorkAudio(true));
    workAudio.addEventListener("error", () => setHasWorkAudio(false));
    workAudioRef.current = workAudio;

    // 休憩終了用の音声ファイルをチェック
    const breakAudio = new Audio("/notification-break.mp3");
    breakAudio.addEventListener("canplaythrough", () => setHasBreakAudio(true));
    breakAudio.addEventListener("error", () => setHasBreakAudio(false));
    breakAudioRef.current = breakAudio;

    return () => {
      workAudio.remove();
      breakAudio.remove();
    };
  }, []);

  // Web Audio APIで通知音を生成
  const playNotificationSound = (type: "work" | "break") => {
    console.log(`🔊 Playing notification sound: ${type}`);
    if (typeof window === "undefined") return;

    const audioFile =
      type === "work" ? workAudioRef.current : breakAudioRef.current;
    const hasAudioFile = type === "work" ? hasWorkAudio : hasBreakAudio;

    console.log(
      `Audio file available: ${hasAudioFile}, Audio element:`,
      audioFile,
    );

    // 音声ファイルが存在する場合はそれを使用
    if (hasAudioFile && audioFile) {
      console.log("Using audio file");
      audioFile.loop = false; // ループを無効化
      audioFile
        .play()
        .then(() => {
          console.log("✅ Audio file playing successfully");
        })
        .catch((error) => {
          console.error("❌ Audio file play failed:", error);
          // 音声ファイルの再生に失敗した場合はWeb Audio APIを使用
          playWebAudioBeep();
        });
      return;
    }

    console.log("Using Web Audio API beep");
    // 音声ファイルがない場合はWeb Audio APIで生成
    playWebAudioBeep();
  };

  const playWebAudioBeep = () => {
    console.log("🎵 Playing Web Audio API beep");
    if (!audioContextRef.current) {
      console.log("Creating new AudioContext");
      audioContextRef.current = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }

    const playBeep = () => {
      const context = audioContextRef.current;
      if (!context) {
        console.error("❌ No AudioContext available");
        return;
      }

      console.log("🎶 Playing beep sound");
      // オシレーター（音源）を作成
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      // 周波数と音量を設定
      oscillator.frequency.value = 800; // 800Hzの音
      gainNode.gain.setValueAtTime(0.3, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime + 0.5,
      );

      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.5);
    };

    // 一度だけ再生
    playBeep();
  };

  const stopNotificationSound = () => {
    console.log("🔇 Stopping notification sound");
    if (audioIntervalRef.current) {
      console.log("Clearing interval");
      clearInterval(audioIntervalRef.current);
      audioIntervalRef.current = null;
    }
    // 音声ファイルも停止
    if (workAudioRef.current) {
      console.log("Stopping work audio");
      workAudioRef.current.pause();
      workAudioRef.current.currentTime = 0;
    }
    if (breakAudioRef.current) {
      console.log("Stopping break audio");
      breakAudioRef.current.pause();
      breakAudioRef.current.currentTime = 0;
    }
    console.log("✅ All sounds stopped");
  };

  // 経過時間の更新（総時間）
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (
      isTimerRunning &&
      !isPaused &&
      !showBreakDialog &&
      !showBreakEndDialog &&
      !showOverageDialog &&
      timerStartTime
    ) {
      interval = setInterval(() => {
        const elapsed =
          Math.floor((Date.now() - timerStartTime.getTime()) / 1000) +
          pausedElapsedSeconds;
        setElapsedSeconds(elapsed);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [
    isTimerRunning,
    isPaused,
    showBreakDialog,
    showBreakEndDialog,
    showOverageDialog,
    timerStartTime,
    pausedElapsedSeconds,
  ]);

  // 実作業時間の更新（休憩中は増えない）
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (
      isTimerRunning &&
      !isPaused &&
      !showBreakDialog &&
      !showBreakEndDialog &&
      !showOverageDialog &&
      !isBreakTime
    ) {
      interval = setInterval(() => {
        setWorkSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [
    isTimerRunning,
    isPaused,
    showBreakDialog,
    showBreakEndDialog,
    showOverageDialog,
    isBreakTime,
  ]);

  // ポモドーロタイマー
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (
      isTimerRunning &&
      !isPaused &&
      !showBreakDialog && // 休憩確認中は停止
      !showBreakEndDialog && // 休憩終了確認中は停止
      !showOverageDialog &&
      !isBreakTime
    ) {
      interval = setInterval(() => {
        setPomodoroSeconds((prev) => {
          const newSeconds = prev + 1;
          if (newSeconds >= POMODORO_DURATION) {
            // 25分経過 - 休憩ダイアログ表示
            setShowBreakDialog(true);
            playNotificationSound("work");
            return POMODORO_DURATION; // 正確に25分を表示
          }
          return newSeconds;
        });
      }, 1000);
    } else if (
      isTimerRunning &&
      !isPaused &&
      !showBreakDialog &&
      !showBreakEndDialog &&
      !showOverageDialog &&
      isBreakTime
    ) {
      const breakDuration = pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK;
      interval = setInterval(() => {
        setPomodoroSeconds((prev) => {
          const newSeconds = prev + 1;
          if (newSeconds >= breakDuration) {
            // 休憩終了 - ダイアログ表示
            setShowBreakEndDialog(true);
            playNotificationSound("break");
            return breakDuration; // 正確に休憩時間を表示
          }
          return newSeconds;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [
    isTimerRunning,
    isPaused,
    showBreakDialog,
    showBreakEndDialog,
    showOverageDialog,
    isBreakTime,
    pomodoroCount,
  ]);
  // 状態変更を親コンポーネントに通知
  useEffect(() => {
    if (onStatusChange) {
      const remainingSeconds = isBreakTime
        ? (pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK) - pomodoroSeconds
        : POMODORO_DURATION - pomodoroSeconds;

      onStatusChange({
        isRunning: isTimerRunning,
        isPaused: isPaused,
        isBreak: isBreakTime,
        pomodoroCount: pomodoroCount,
        remainingSeconds: remainingSeconds,
      });
    }
  }, [
    isTimerRunning,
    isPaused,
    isBreakTime,
    pomodoroCount,
    pomodoroSeconds,
    onStatusChange,
  ]);
  const handleStartTimer = async () => {
    try {
      // AudioContextを初期化（ユーザーの操作後なので自動再生が許可される）
      if (typeof window !== "undefined" && !audioContextRef.current) {
        audioContextRef.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      }

      // 音壵ファイルをプリロード
      if (workAudioRef.current) {
        workAudioRef.current.load();
      }
      if (breakAudioRef.current) {
        breakAudioRef.current.load();
      }

      const res = await fetch(`${API_BASE}/tasks/${taskId}/start-timer`, {
        method: "POST",
      });
      if (res.ok) {
        setIsTimerRunning(true);
        setIsPaused(false);
        setTimerStartTime(new Date());
        setPomodoroSeconds(0);
        setPausedPomodoroSeconds(0);
        setElapsedSeconds(0);
        setPausedElapsedSeconds(0);
        setWorkSeconds(0);
        setPausedWorkSeconds(0);
        onUpdate();
      }
    } catch (err) {
      console.error("Failed to start timer:", err);
    }
  };

  const handlePauseTimer = () => {
    setIsPaused(true);
    setPausedElapsedSeconds(elapsedSeconds);
    setPausedPomodoroSeconds(pomodoroSeconds);
    setPausedWorkSeconds(workSeconds);
  };

  const handleResumeTimer = () => {
    setIsPaused(false);
    // 一時停止からの再開時、新しい開始時刻を設定
    const now = new Date();
    const adjustedStartTime = new Date(
      now.getTime() - pausedElapsedSeconds * 1000,
    );
    setTimerStartTime(adjustedStartTime);
  };

  const handleStopTimer = async () => {
    if (!timerStartTime) return;

    const workHours = workSeconds / 3600; // 実作業時間（h）
    const breakHours = accumulatedBreakSeconds / 3600; // 休憩時間（h）

    const newActualHours = (actualHours || 0) + workHours;
    const isOverage = estimatedHours && newActualHours > estimatedHours;

    // タイマー状態をすぐにリセット
    setIsTimerRunning(false);
    setIsPaused(false);

    if (isOverage) {
      // 見積もり超過 - 理由を聞く
      setShowOverageDialog(true);
    } else {
      // 通常停止 - 自動保存
      await saveTimeEntry("", breakHours);
    }
  };

  const saveTimeEntry = async (note: string, breakHours: number) => {
    if (!timerStartTime) return;

    try {
      const endTime = new Date();
      const workHours = workSeconds / 3600;

      await fetch(`${API_BASE}/tasks/${taskId}/time-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: workHours,
          breakDuration: breakHours,
          note: note || undefined,
          startedAt: timerStartTime.toISOString(),
          endedAt: endTime.toISOString(),
        }),
      });

      // タスクのactualHoursを更新
      await fetch(`${API_BASE}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualHours: (actualHours || 0) + workHours,
          startedAt: null,
        }),
      });

      // リセット
      setIsTimerRunning(false);
      setTimerStartTime(null);
      setElapsedSeconds(0);
      setWorkSeconds(0);
      setPausedWorkSeconds(0);
      setPomodoroSeconds(0);
      setAccumulatedBreakSeconds(0);
      setPomodoroCount(0);
      setIsBreakTime(false);
      setOverageReason("");
      setShowOverageDialog(false);

      onUpdate();
    } catch (err) {
      console.error("Failed to save time entry:", err);
    }
  };

  const handleTakeBreak = () => {
    setPomodoroCount((c) => c + 1);
    setIsBreakTime(true);
    setPomodoroSeconds(0);
    setShowBreakDialog(false);
    // 音声を停止
    stopNotificationSound();
    // ダイアログを閉じた時点からタイマーを再開するため、開始時刻を調整
    if (timerStartTime) {
      const now = new Date();
      const adjustedStartTime = new Date(now.getTime() - elapsedSeconds * 1000);
      setTimerStartTime(adjustedStartTime);
    }
  };

  const handleSkipBreak = () => {
    setPomodoroCount((c) => c + 1);
    setPomodoroSeconds(0);
    setShowBreakDialog(false);
    // 音声を停止
    stopNotificationSound();
    // ダイアログを閉じた時点からタイマーを再開するため、開始時刻を調整
    if (timerStartTime) {
      const now = new Date();
      const adjustedStartTime = new Date(now.getTime() - elapsedSeconds * 1000);
      setTimerStartTime(adjustedStartTime);
    }
  };

  const handleBreakEnd = () => {
    console.log("🔄 Handling break end");
    // 休憩時間を累積に加算
    const breakDuration = pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK;
    setAccumulatedBreakSeconds((acc) => acc + breakDuration);

    setIsBreakTime(false);
    setPomodoroSeconds(0);
    setShowBreakEndDialog(false);
    // 音声を停止
    stopNotificationSound();
    // タイマーを調整
    if (timerStartTime) {
      const now = new Date();
      const adjustedStartTime = new Date(now.getTime() - elapsedSeconds * 1000);
      setTimerStartTime(adjustedStartTime);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const remainingHours =
    estimatedHours && actualHours
      ? Math.max(0, estimatedHours - actualHours)
      : estimatedHours || 0;

  const progressPercent =
    estimatedHours && actualHours
      ? Math.min((actualHours / estimatedHours) * 100, 100)
      : 0;

  const totalBreakHours =
    timeEntries.reduce((sum, entry) => sum + (entry.breakDuration || 0), 0) +
    accumulatedBreakSeconds / 3600;

  const breakType =
    pomodoroCount > 0 && pomodoroCount % 4 === 0 ? "長い休憩" : "短い休憩";
  const breakDuration = pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK;

  // 円形プログレスバー用の計算
  const currentDuration = isBreakTime ? breakDuration : POMODORO_DURATION;
  const remainingTime = isBreakTime
    ? breakDuration - pomodoroSeconds
    : POMODORO_DURATION - pomodoroSeconds;
  const progress = Math.max(
    0,
    Math.min(((currentDuration - remainingTime) / currentDuration) * 100, 100),
  ); // 0-100%の範囲に制限
  const circumference = 2 * Math.PI * 120; // 半径120の円周
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center py-8">
      {/* 作業時間と休憩時間 */}
      <div className="flex gap-4 mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        <div className="flex items-center gap-1">
          <Hourglass className="w-4 h-4" />
          <span>作業時間: {formatTime(workSeconds)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Coffee className="w-4 h-4" />
          <span>休憩時間: {formatTime(accumulatedBreakSeconds)}</span>
        </div>
      </div>

      {/* 円形プログレスバーとタイマー */}
      <div className="relative mb-8">
        {/* SVG円形プログレスバー */}
        <svg className="w-64 h-64 transform -rotate-90">
          {/* 背景の円 */}
          <circle
            cx="128"
            cy="128"
            r="120"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            className="text-zinc-200 dark:text-zinc-800"
          />
          {/* プログレスの円 */}
          <circle
            cx="128"
            cy="128"
            r="120"
            stroke="currentColor"
            strokeWidth="8"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`transition-all duration-1000 ${
              isBreakTime
                ? "text-green-500"
                : isPaused
                  ? "text-orange-500"
                  : "text-blue-500"
            }`}
            strokeLinecap="round"
          />
        </svg>

        {/* 中央のタイマー表示 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {/* ポモドーロカウンター */}
          <div className="flex gap-2 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                {i < pomodoroCount ? (
                  <Icon iconNode={fruit} className="w-5 h-5 text-red-500" />
                ) : (
                  <Circle className="w-5 h-5 text-zinc-300 dark:text-zinc-700" />
                )}
              </div>
            ))}
          </div>
          <div className="text-6xl font-bold font-mono text-zinc-900 dark:text-zinc-50">
            {formatTime(
              isBreakTime
                ? breakDuration - pomodoroSeconds
                : POMODORO_DURATION - pomodoroSeconds,
            )}
          </div>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
            {isBreakTime
              ? "休憩中"
              : isPaused
                ? "一時停止"
                : isTimerRunning
                  ? "作業中"
                  : "準備完了"}
          </div>
        </div>
      </div>

      {/* 休憩選択UI（25分完了時に表示） */}
      {showBreakDialog && (
        <div className="mb-6 p-6 bg-green-50 dark:bg-green-950 rounded-xl border-2 border-green-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-green-700 dark:text-green-300 mb-2">
              25分完了！{breakType}を取りますか？
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              ({pomodoroCount % 4 === 0 ? "15" : "5"}分)
            </div>
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleTakeBreak}
              className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              休憩する
            </button>
            <button
              onClick={handleSkipBreak}
              className="px-6 py-3 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-50 rounded-lg font-medium transition-colors"
            >
              スキップ
            </button>
          </div>
        </div>
      )}

      {/* 休憩終了通知 */}
      {showBreakEndDialog && (
        <div className="mb-6 p-6 bg-blue-50 dark:bg-blue-950 rounded-xl border-2 border-blue-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-blue-700 dark:text-blue-300">
              休憩終了！作業を再開しましょう
            </div>
          </div>
          <button
            onClick={handleBreakEnd}
            className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            作業を再開
          </button>
        </div>
      )}

      {/* コントロールボタン */}
      {!showBreakDialog && !showBreakEndDialog && (
        <div className="flex gap-3 justify-center">
          {isBreakTime ? null : isTimerRunning ? (
            <>
              {isPaused ? (
                <button
                  onClick={handleResumeTimer}
                  className="flex items-center gap-2 px-8 py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all"
                >
                  <Play className="w-5 h-5" />
                  再開
                </button>
              ) : (
                <button
                  onClick={handlePauseTimer}
                  className="flex items-center gap-2 px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-semibold transition-all"
                >
                  <Pause className="w-5 h-5" />
                  一時停止
                </button>
              )}
              <button
                onClick={handleStopTimer}
                className="flex items-center gap-2 px-8 py-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all"
              >
                <Square className="w-5 h-5" />
                停止
              </button>
            </>
          ) : (
            <button
              onClick={handleStartTimer}
              className="flex items-center gap-2 px-12 py-5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-lg transition-all"
            >
              <Play className="w-6 h-6" />
              開始
            </button>
          )}
        </div>
      )}

      {/* 見積もり超過ダイアログ */}
      {showOverageDialog && (
        <div className="mt-6 p-6 bg-orange-50 dark:bg-orange-950 rounded-xl border-2 border-orange-500">
          <div className="text-center mb-4">
            <div className="text-lg font-semibold text-orange-700 dark:text-orange-300 mb-2">
              見積もり時間を超過
            </div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              予定より時間がかかった理由を記録してください
            </p>
          </div>
          <textarea
            value={overageReason}
            onChange={(e) => setOverageReason(e.target.value)}
            placeholder="例: 仕様変更、想定外のバグ、調査に時間..."
            className="w-full px-4 py-3 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-orange-500 mb-4"
            rows={3}
          />
          <button
            onClick={() =>
              saveTimeEntry(
                overageReason || "見積もり超過",
                accumulatedBreakSeconds / 3600,
              )
            }
            disabled={!overageReason.trim()}
            className="w-full px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
          >
            記録する
          </button>
        </div>
      )}
    </div>
  );
}
