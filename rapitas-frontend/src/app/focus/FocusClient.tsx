'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import {
  Play,
  Pause,
  RotateCcw,
  X,
  Check,
  Coffee,
  Target,
  Clock,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('FocusClient');

type FocusMode = 'work' | 'break';

export default function FocusClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('focus');
  const tc = useTranslations('common');
  const { showToast } = useToast();
  const taskId = searchParams.get('taskId');

  const [task, setTask] = useState<Task | null>(null);
  const [mode, setMode] = useState<FocusMode>('work');
  const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessions] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [customWorkTime, setCustomWorkTime] = useState(25);
  const [customBreakTime, setCustomBreakTime] = useState(5);
  const [startTime, setStartTime] = useState<Date | null>(null);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchTask = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${id}`);
      if (res.ok) {
        setTask(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch task:', e);
    }
  }, []);

  const saveTimeEntry = useCallback(async () => {
    const endTime = new Date();
    const duration = customWorkTime / 60; // Convert to hours

    try {
      // Record time if linked to a task
      if (taskId && startTime) {
        const res = await fetch(
          `${API_BASE_URL}/tasks/${taskId}/time-entries`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              duration,
              startedAt: startTime.toISOString(),
              endedAt: endTime.toISOString(),
              note: t('focusSessionNote', { number: sessionsCompleted + 1 }),
            }),
          },
        );

        if (res.ok) {
          setSessions((prev) => prev + 1);
          showToast(
            t('workTimeRecorded', { minutes: customWorkTime }),
            'success',
          );
        }
      }

      // Update study statistics
      await fetch(`${API_BASE_URL}/statistics/daily-study`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hours: duration,
          date: new Date().toISOString().split('T')[0],
        }),
      });
    } catch (e) {
      logger.error('Failed to save time entry:', e);
    }
  }, [customWorkTime, taskId, startTime, sessionsCompleted, showToast]);

  const playNotificationSound = useCallback(() => {
    // Generate simple beep sound
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;

    oscillator.start();
    setTimeout(() => oscillator.stop(), 200);
  }, []);

  const handleTimerComplete = useCallback(() => {
    setIsRunning(false);

    // Notification sound
    if (soundEnabled) {
      playNotificationSound();
    }

    // Browser notification
    if (Notification.permission === 'granted') {
      new Notification(
        mode === 'work' ? t('workTimeFinished') : t('breakFinished'),
        {
          body:
            mode === 'work' ? t('takeBreakMessage') : t('resumeWorkMessage'),
          icon: '/favicon.ico',
        },
      );
    }

    if (mode === 'work') {
      // Work completed, save record
      saveTimeEntry();
      setSessions((prev) => prev + 1);
      setMode('break');
      setTimeLeft(customBreakTime * 60);
    } else {
      // Break completed
      setMode('work');
      setTimeLeft(customWorkTime * 60);
    }
  }, [
    soundEnabled,
    mode,
    saveTimeEntry,
    customBreakTime,
    customWorkTime,
    playNotificationSound,
  ]);

  const startTimer = () => {
    if (!isRunning && mode === 'work') {
      setStartTime(new Date());
    }
    setIsRunning(true);

    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const pauseTimer = () => {
    setIsRunning(false);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setTimeLeft(mode === 'work' ? customWorkTime * 60 : customBreakTime * 60);
    setStartTime(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (taskId) {
      // Use setTimeout to avoid synchronous setState call
      const timeoutId = setTimeout(() => {
        fetchTask(parseInt(taskId));
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [taskId, fetchTask]);

  useEffect(() => {
    if (isRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isRunning) {
      // Use setTimeout to avoid synchronous setState call
      const timeoutId = setTimeout(() => {
        handleTimerComplete();
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, timeLeft, handleTimerComplete]);

  const progress =
    mode === 'work'
      ? ((customWorkTime * 60 - timeLeft) / (customWorkTime * 60)) * 100
      : ((customBreakTime * 60 - timeLeft) / (customBreakTime * 60)) * 100;

  const completeTask = async () => {
    if (!taskId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      if (res.ok) {
        showToast(t('taskCompleted'), 'success');
        router.push('/');
      } else {
        showToast(t('taskCompleteFailed'), 'error');
      }
    } catch (e) {
      logger.error('Failed to complete task:', e);
      showToast(tc('errorOccurred'), 'error');
    }
  };

  return (
    <div
      className={`min-h-screen transition-colors duration-500 ${
        mode === 'work'
          ? 'bg-linear-to-br from-indigo-950 via-slate-900 to-purple-950'
          : 'bg-linear-to-br from-emerald-950 via-slate-900 to-teal-950'
      }`}
    >
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => router.back()}
          className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            {soundEnabled ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      <div
        className="flex flex-col items-center justify-center px-4 pb-8"
        style={{ minHeight: 'calc(100vh - 80px)' }}
      >
        {task && (
          <div className="mb-8 text-center">
            <p className="text-white/60 text-sm mb-1">{t('currentTask')}</p>
            <h2 className="text-xl font-semibold text-white">{task.title}</h2>
          </div>
        )}

        <div
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-full mb-8 ${
            mode === 'work'
              ? 'bg-indigo-500/20 text-indigo-300'
              : 'bg-emerald-500/20 text-emerald-300'
          }`}
        >
          {mode === 'work' ? (
            <>
              <Target className="w-4 h-4" />
              <span className="text-sm font-medium">{t('focusTime')}</span>
            </>
          ) : (
            <>
              <Coffee className="w-4 h-4" />
              <span className="text-sm font-medium">{t('breakTime')}</span>
            </>
          )}
        </div>

        <div className="relative w-72 h-72 mb-8">
          <svg className="w-full h-full -rotate-90">
            <circle
              cx="144"
              cy="144"
              r="136"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-white/10"
            />
            <circle
              cx="144"
              cy="144"
              r="136"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeDasharray={2 * Math.PI * 136}
              strokeDashoffset={2 * Math.PI * 136 * (1 - progress / 100)}
              strokeLinecap="round"
              className={`transition-all duration-1000 ${
                mode === 'work' ? 'text-indigo-400' : 'text-emerald-400'
              }`}
            />
          </svg>

          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-6xl font-bold text-white font-mono">
              {formatTime(timeLeft)}
            </span>
            <span className="text-white/40 text-sm mt-2">
              {t('session', { number: sessionsCompleted + 1 })}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={resetTimer}
            className="p-4 text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <RotateCcw className="w-6 h-6" />
          </button>

          <button
            onClick={isRunning ? pauseTimer : startTimer}
            className={`w-20 h-20 rounded-full flex items-center justify-center transition-all ${
              mode === 'work'
                ? 'bg-indigo-500 hover:bg-indigo-400'
                : 'bg-emerald-500 hover:bg-emerald-400'
            }`}
          >
            {isRunning ? (
              <Pause className="w-8 h-8 text-white" />
            ) : (
              <Play className="w-8 h-8 text-white ml-1" />
            )}
          </button>

          {task && (
            <button
              onClick={completeTask}
              className="p-4 text-white/60 hover:text-emerald-400 hover:bg-white/10 rounded-full transition-colors"
              title={t('completeTask')}
            >
              <Check className="w-6 h-6" />
            </button>
          )}
        </div>

        {!isRunning && (
          <div className="flex items-center gap-6 text-white/60">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span className="text-sm">{t('work')}</span>
              <select
                value={customWorkTime}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setCustomWorkTime(val);
                  if (mode === 'work') setTimeLeft(val * 60);
                }}
                className="bg-white/10 border-none rounded px-2 py-1 text-sm text-white"
              >
                <option value={15}>{t('minutes', { count: 15 })}</option>
                <option value={25}>{t('minutes', { count: 25 })}</option>
                <option value={30}>{t('minutes', { count: 30 })}</option>
                <option value={45}>{t('minutes', { count: 45 })}</option>
                <option value={60}>{t('minutes', { count: 60 })}</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Coffee className="w-4 h-4" />
              <span className="text-sm">{t('break')}</span>
              <select
                value={customBreakTime}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setCustomBreakTime(val);
                  if (mode === 'break') setTimeLeft(val * 60);
                }}
                className="bg-white/10 border-none rounded px-2 py-1 text-sm text-white"
              >
                <option value={5}>{t('minutes', { count: 5 })}</option>
                <option value={10}>{t('minutes', { count: 10 })}</option>
                <option value={15}>{t('minutes', { count: 15 })}</option>
              </select>
            </div>
          </div>
        )}

        {sessionsCompleted > 0 && (
          <div className="mt-8 flex items-center gap-2">
            {Array.from({ length: sessionsCompleted }).map((_, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-full ${
                  mode === 'work' ? 'bg-indigo-400' : 'bg-emerald-400'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
