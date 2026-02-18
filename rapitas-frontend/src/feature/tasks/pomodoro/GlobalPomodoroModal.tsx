'use client';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Timer,
  ExternalLink,
  X,
  Settings,
  Volume2,
  VolumeX,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';
import PomodoroTimer from '@/feature/tasks/components/PomodoroTimer';
import { usePomodoroStore, formatTime } from './pomodoroStore';
import { TimeEntry } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';

interface GlobalPomodoroModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  const [showSettings, setShowSettings] = useState(false);

  // クライアントサイドでのみportalをマウント
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => {
      clearTimeout(timer);
      setMounted(false);
    };
  }, []);

  // タスクのtime entriesとタスクデータを取得
  useEffect(() => {
    if (state.taskId && isOpen) {
      fetch(`${API_BASE_URL}/tasks/${state.taskId}/time-entries`)
        .then((res) => {
          if (!res.ok) return [];
          return res.json();
        })
        .then((data) => setTimeEntries(data))
        .catch((err) => console.error('Failed to fetch time entries:', err));

      fetch(`${API_BASE_URL}/tasks/${state.taskId}`)
        .then((res) => {
          if (!res.ok) {
            // タスクが見つからない場合はタイマーを停止してモーダルを閉じる
            console.log('Task not found, stopping timer');
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
        .catch((err) => console.error('Failed to fetch task:', err));
    }
  }, [state.taskId, isOpen, state.stopTimer, onClose]);

  if (!isOpen) return null;
  if (!state.isTimerRunning || !state.taskId || !state.taskTitle) return null;
  if (!mounted) return null;

  const handleUpdate = () => {
    if (state.taskId) {
      fetch(`${API_BASE_URL}/tasks/${state.taskId}/time-entries`)
        .then((res) => {
          if (!res.ok) return [];
          return res.json();
        })
        .then((data) => setTimeEntries(data))
        .catch((err) => console.error('Failed to fetch time entries:', err));

      fetch(`${API_BASE_URL}/tasks/${state.taskId}`)
        .then((res) => {
          if (!res.ok) {
            // タスクが見つからない場合はタイマーを停止してモーダルを閉じる
            console.log('Task not found, stopping timer');
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
        .catch((err) => console.error('Failed to fetch task:', err));
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-9999 p-4 overflow-y-auto"
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
            href={getTaskDetailPath(state.taskId)}
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

        {/* 今日の統計 */}
        <div className="px-4 py-3 bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              今日の統計
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white dark:bg-zinc-900 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {state.todayCompletedPomodoros || 0}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                完了ポモドーロ
              </div>
            </div>
            <div className="bg-white dark:bg-zinc-900 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {formatTime(state.todayTotalWorkSeconds || 0)}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                合計作業時間
              </div>
            </div>
          </div>
        </div>

        {/* 設定セクション */}
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              設定
            </div>
            {showSettings ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showSettings && (
            <div className="px-4 pb-4 space-y-4">
              {/* 音声設定 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-600 dark:text-zinc-400">
                    通知音
                  </label>
                  <button
                    onClick={() =>
                      state.updateSettings({
                        soundEnabled: !state.settings.soundEnabled,
                      })
                    }
                    className={`p-2 rounded-lg transition-colors ${
                      state.settings.soundEnabled
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-600'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {state.settings.soundEnabled ? (
                      <Volume2 className="w-4 h-4" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {state.settings.soundEnabled && (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">小</span>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={state.settings.soundVolume}
                      onChange={(e) =>
                        state.updateSettings({
                          soundVolume: parseFloat(e.target.value),
                        })
                      }
                      className="flex-1 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="text-xs text-zinc-500">大</span>
                  </div>
                )}
              </div>

              {/* 時間設定 */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    作業時間
                  </label>
                  <select
                    value={state.settings.pomodoroDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        pomodoroDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[15, 20, 25, 30, 45, 60].map((min) => (
                      <option key={min} value={min}>
                        {min}分
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    短い休憩
                  </label>
                  <select
                    value={state.settings.shortBreakDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        shortBreakDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[3, 5, 10, 15].map((min) => (
                      <option key={min} value={min}>
                        {min}分
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
                    長い休憩
                  </label>
                  <select
                    value={state.settings.longBreakDuration / 60}
                    onChange={(e) =>
                      state.updateSettings({
                        longBreakDuration: parseInt(e.target.value) * 60,
                      })
                    }
                    className="w-full px-2 py-1.5 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg"
                  >
                    {[10, 15, 20, 30].map((min) => (
                      <option key={min} value={min}>
                        {min}分
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // document.bodyにPortalでレンダリングしてHeaderのz-indexから独立させる
  return createPortal(modalContent, document.body);
}
