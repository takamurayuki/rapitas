/**
 * ポモドーロ統計フック
 * ポモドーロの実績データをAPIから取得し統計情報を提供する
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('usePomodoroStats');

interface PomodoroStatsData {
  todayCompleted: number;
  todayMinutes: number;
  weeklyCompleted: number;
  weeklyMinutes: number;
  totalCompleted: number;
  averageFocusMinutes: number;
}

const EMPTY_STATS: PomodoroStatsData = {
  todayCompleted: 0,
  todayMinutes: 0,
  weeklyCompleted: 0,
  weeklyMinutes: 0,
  totalCompleted: 0,
  averageFocusMinutes: 0,
};

export function usePomodoroStats() {
  const [stats, setStats] = useState<PomodoroStatsData>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/pomodoro/stats`);
      if (!res.ok) throw new Error(`Failed to fetch stats: ${res.status}`);
      const data = await res.json();
      setStats(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'ポモドーロ統計の取得に失敗しました';
      setError(message);
      logger.error('Failed to fetch pomodoro stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const todayTotal = stats.todayMinutes;
  const weeklyAverage = stats.weeklyCompleted > 0 ? Math.round(stats.weeklyMinutes / 7) : 0;

  return {
    stats,
    isLoading,
    error,
    todayTotal,
    weeklyAverage,
    refresh: fetchStats,
  };
}
