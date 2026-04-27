'use client';
import { type TimeEntry } from '@/types';
import { useState, useEffect, useRef } from 'react';

interface TaskTimeTrackingProps {
  estimatedHours?: number;
  actualHours?: number;
  isTimerRunning: boolean;
  timeEntries: TimeEntry[];
  onStartTimer: () => void;
  onStopTimer: (breakDuration?: number) => void;
  getElapsedTime: () => string;
  formatDuration: (hours: number) => string;
  getAccumulatedBreakTime?: React.MutableRefObject<(() => number) | undefined>;
}

const POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
const SHORT_BREAK = 5 * 60; // 5 minutes
const LONG_BREAK = 15 * 60; // 15 minutes

export default function TaskTimeTracking({
  estimatedHours,
  actualHours,
  isTimerRunning,
  timeEntries,
  onStartTimer,
  onStopTimer,
  getElapsedTime,
  formatDuration,
  getAccumulatedBreakTime: getAccumulatedBreakTimeRef,
}: TaskTimeTrackingProps) {
  const [pomodoroSeconds, setPomodoroSeconds] = useState(0);
  const [isBreakTime, setIsBreakTime] = useState(false);
  const [pomodoroCount, setPomodoroCount] = useState(0);
  const [showBreakDialog, setShowBreakDialog] = useState(false);
  const [accumulatedBreakSeconds, setAccumulatedBreakSeconds] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Allow parent component to retrieve break time
  useEffect(() => {
    if (getAccumulatedBreakTimeRef) {
      // Return current accumulated break time in hours when this function is called
      getAccumulatedBreakTimeRef.current = () => accumulatedBreakSeconds / 3600;
    }
  }, [accumulatedBreakSeconds, getAccumulatedBreakTimeRef]);

  // Pomodoro timer (25min work -> 5min break)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isTimerRunning && !isBreakTime) {
      interval = setInterval(() => {
        setPomodoroSeconds((prev) => {
          if (prev >= POMODORO_DURATION) {
            // 25 minutes elapsed - transition to break
            setIsBreakTime(true);
            setShowBreakDialog(true);
            setPomodoroCount((c) => c + 1);
            // Play notification sound
            if (audioRef.current) {
              audioRef.current.play().catch(() => {});
            }
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else if (isTimerRunning && isBreakTime) {
      const breakDuration = pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK;
      interval = setInterval(() => {
        setPomodoroSeconds((prev) => {
          const newSeconds = prev + 1;
          // Accumulate break time
          setAccumulatedBreakSeconds((acc) => acc + 1);
          if (newSeconds >= breakDuration) {
            // End break
            setIsBreakTime(false);
            if (audioRef.current) {
              audioRef.current.play().catch(() => {});
            }
            return 0;
          }
          return newSeconds;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, isBreakTime, pomodoroCount]);

  const remainingSeconds = isBreakTime
    ? (pomodoroCount % 4 === 0 ? LONG_BREAK : SHORT_BREAK) - pomodoroSeconds
    : POMODORO_DURATION - pomodoroSeconds;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  };

  const remainingHours =
    estimatedHours && actualHours
      ? Math.max(0, estimatedHours - actualHours)
      : estimatedHours || 0;

  const progressPercent =
    estimatedHours && actualHours
      ? Math.min((actualHours / estimatedHours) * 100, 100)
      : 0;

  const handleSkipBreak = () => {
    setIsBreakTime(false);
    setPomodoroSeconds(0);
    setShowBreakDialog(false);
    // Reset accumulated time when break is skipped (don't record skipped time)
  };

  // Calculate total break time (convert to hours)
  const totalBreakHours =
    timeEntries.reduce((sum, entry) => sum + (entry.breakDuration || 0), 0) +
    accumulatedBreakSeconds / 3600;

  // Total time spent (work time + break time)
  const totalElapsedHours = (actualHours || 0) + totalBreakHours;

  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-6 mt-6">
      <audio ref={audioRef} src="/notification.mp3" preload="auto" />

      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 flex items-center gap-2">
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
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        時間トラッキング + ポモドーロ
      </h2>

      {estimatedHours && estimatedHours > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">
                見積もり時間
              </span>
              <span className="ml-2 font-semibold text-zinc-900 dark:text-zinc-50">
                {estimatedHours.toFixed(1)}h
              </span>
            </div>
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">残り時間</span>
              <span
                className={`ml-2 font-semibold ${
                  remainingHours <= 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-blue-600 dark:text-blue-400'
                }`}
              >
                {remainingHours.toFixed(1)}h
              </span>
            </div>
          </div>
          <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-3 mb-1">
            <div
              className={`h-3 rounded-full transition-all ${
                progressPercent >= 100
                  ? 'bg-red-500'
                  : progressPercent >= 80
                    ? 'bg-orange-500'
                    : 'bg-blue-500'
              }`}
              style={{
                width: `${Math.min(progressPercent, 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              作業: {actualHours?.toFixed(1) || 0}h /{' '}
              {estimatedHours.toFixed(1)}h ({progressPercent.toFixed(0)}%)
            </span>
            {totalBreakHours > 0 && (
              <span className="text-zinc-400 dark:text-zinc-500">
                休憩: {totalBreakHours.toFixed(1)}h | 総時間:{' '}
                {totalElapsedHours.toFixed(1)}h
              </span>
            )}
          </div>
        </div>
      )}

      <div className="bg-linear-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🍅</span>
            <div>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {isBreakTime ? '休憩時間' : '作業時間'}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {isBreakTime
                  ? pomodoroCount % 4 === 0
                    ? '長い休憩（15分）'
                    : '短い休憩（5分）'
                  : `ポモドーロ #${pomodoroCount + 1}`}
              </div>
            </div>
          </div>
          {!isBreakTime && (
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              完了: {pomodoroCount}回
            </div>
          )}
        </div>

        <div className="text-center mb-4">
          <div
            className={`text-5xl font-bold font-mono ${
              isBreakTime
                ? 'text-green-600 dark:text-green-400'
                : 'text-blue-600 dark:text-blue-400'
            }`}
          >
            {formatTime(remainingSeconds)}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            {isBreakTime ? '休憩終了まで' : '次の休憩まで'}
          </div>
        </div>

        <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 mb-4">
          <div
            className={`h-2 rounded-full transition-all ${
              isBreakTime ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{
              width: `${
                (((isBreakTime
                  ? pomodoroCount % 4 === 0
                    ? LONG_BREAK
                    : SHORT_BREAK
                  : POMODORO_DURATION) -
                  remainingSeconds) /
                  (isBreakTime
                    ? pomodoroCount % 4 === 0
                      ? LONG_BREAK
                      : SHORT_BREAK
                    : POMODORO_DURATION)) *
                100
              }%`,
            }}
          />
        </div>

        <div className="flex gap-2">
          {isTimerRunning ? (
            <>
              <button
                onClick={() => {
                  const breakHours = accumulatedBreakSeconds / 3600;
                  onStopTimer(breakHours);
                  setAccumulatedBreakSeconds(0); // Reset on stop
                }}
                className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z"
                    clipRule="evenodd"
                  />
                </svg>
                停止
              </button>
              <div className="flex-1 bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 rounded-lg px-4 py-2 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-xs text-blue-700 dark:text-blue-300 mb-0.5">
                    経過時間
                  </div>
                  <div className="text-lg font-mono font-bold text-blue-600 dark:text-blue-400">
                    {getElapsedTime()}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <button
              onClick={onStartTimer}
              className="w-full px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              🍅 ポモドーロ開始
            </button>
          )}
        </div>
      </div>

      {showBreakDialog && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setShowBreakDialog(false)}
          />
          <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-60 bg-white dark:bg-indigo-dark-900 rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">🎉</div>
              <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-2">
                ポモドーロ完了！
              </h3>
              <p className="text-zinc-600 dark:text-zinc-400">
                25分間の作業お疲れ様でした。
                {pomodoroCount % 4 === 0 ? '15分の長い休憩' : '5分の短い休憩'}
                を取りましょう。
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowBreakDialog(false);
                  // Break timer will start automatically
                }}
                className="flex-1 px-4 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 font-medium transition-colors"
              >
                休憩する
              </button>
              <button
                onClick={handleSkipBreak}
                className="flex-1 px-4 py-3 bg-zinc-200 dark:bg-indigo-dark-800 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 font-medium transition-colors"
              >
                スキップ
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
