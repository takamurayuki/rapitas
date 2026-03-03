'use client';
import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Timer, TrendingUp, Calendar } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { formatTime } from './pomodoroStore';

type DailyStat = { date: string; count: number; minutes: number };
type TaskStat = { taskId: number; title: string; count: number; minutes: number };

type PomodoroStats = {
  totalPomodoros: number;
  totalMinutes: number;
  averagePerDay: number;
  dailyStats: DailyStat[];
  taskStats: TaskStat[];
};

export default function PomodoroStatistics() {
  const [stats, setStats] = useState<PomodoroStats | null>(null);
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const endDate = new Date();
      const startDate = new Date();
      if (period === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setDate(startDate.getDate() - 30);
      }

      const res = await fetch(
        `${API_BASE_URL}/pomodoro/statistics?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
      );
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error('Failed to fetch pomodoro stats:', e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-4">
        <div className="h-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
        <div className="h-40 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
      </div>
    );
  }

  if (!stats) return null;

  const maxDailyCount = Math.max(...stats.dailyStats.map(d => d.count), 1);

  return (
    <div className="space-y-4">
      {/* 期間切り替え */}
      <div className="flex gap-2">
        <button
          onClick={() => setPeriod('week')}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            period === 'week'
              ? 'bg-blue-500 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
        >
          週間
        </button>
        <button
          onClick={() => setPeriod('month')}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
            period === 'month'
              ? 'bg-blue-500 text-white'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
          }`}
        >
          月間
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-1">
            <Timer className="w-4 h-4" />
            <span className="text-xs">完了数</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.totalPomodoros}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-1">
            <BarChart3 className="w-4 h-4" />
            <span className="text-xs">合計時間</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatTime(stats.totalMinutes * 60)}
          </div>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs">日平均</span>
          </div>
          <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {stats.averagePerDay}
          </div>
        </div>
      </div>

      {/* 日別チャート */}
      {stats.dailyStats.length > 0 && (
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            日別ポモドーロ数
          </h3>
          <div className="flex items-end gap-1 h-24">
            {stats.dailyStats.slice(-14).map((day) => (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center gap-1"
              >
                <div
                  className="w-full bg-blue-500 dark:bg-blue-400 rounded-t-sm min-h-[2px] transition-all"
                  style={{
                    height: `${(day.count / maxDailyCount) * 100}%`,
                  }}
                  title={`${day.date}: ${day.count}回 (${Math.round(day.minutes)}分)`}
                />
                <span className="text-[9px] text-zinc-400 dark:text-zinc-500">
                  {day.date.slice(-2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* タスク別ランキング */}
      {stats.taskStats.length > 0 && (
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3">
            タスク別集中時間
          </h3>
          <div className="space-y-2">
            {stats.taskStats.slice(0, 5).map((task) => (
              <div key={task.taskId} className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate text-zinc-700 dark:text-zinc-300">
                    {task.title}
                  </div>
                  <div className="w-full bg-zinc-100 dark:bg-zinc-700 rounded-full h-1.5 mt-1">
                    <div
                      className="bg-blue-500 rounded-full h-1.5 transition-all"
                      style={{
                        width: `${(task.count / stats.taskStats[0]!.count) * 100}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                  {task.count}回 / {Math.round(task.minutes)}分
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
