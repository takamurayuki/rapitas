/**
 * use-dashboard-data
 *
 * Data-fetching hook for the dashboard page: overview statistics, the daily
 * study series, and the current streak. Rendering is owned by the page and
 * its _components.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ExamGoal, StudyStreak } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DashboardPage');

export type OverviewStats = {
  tasks: {
    total: number;
    completed: number;
    todayCompleted: number;
    weekCompleted: number;
    completionRate: number;
  };
  studyTime: {
    weekHours: number;
    monthHours: number;
  };
  upcomingExams: ExamGoal[];
  streakData: StudyStreak[];
};

export type DailyStudy = {
  date: string;
  hours: number;
};

export type StreakInfo = {
  currentStreak: number;
  longestStreak: number;
  today: string;
};

/**
 * Fetch all dashboard data (overview stats, daily study series, streak) in parallel.
 *
 * @returns Overview stats, the 14-day study series, streak info, and a loading flag. / 概要統計・14日間の学習系列・連続記録・ローディングフラグ。
 */
export function useDashboardData() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [dailyStudy, setDailyStudy] = useState<DailyStudy[]>([]);
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/statistics/overview`);
      if (res.ok) {
        setOverview(await res.json());
      }
    } catch (e) {
      logger.transientError('Failed to fetch overview:', e);
    }
  }, []);

  const fetchDailyStudy = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/statistics/daily-study?days=14`);
      if (res.ok) {
        const data = await res.json();
        setDailyStudy(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      logger.transientError('Failed to fetch daily study:', e);
    }
  }, []);

  const fetchStreakInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/study-streaks/current`);
      if (res.ok) {
        setStreakInfo(await res.json());
      }
    } catch (e) {
      logger.transientError('Failed to fetch streak info:', e);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([fetchOverview(), fetchDailyStudy(), fetchStreakInfo()]);
      setLoading(false);
    };

    loadData();
  }, [fetchOverview, fetchDailyStudy, fetchStreakInfo]);

  return { overview, dailyStudy, streakInfo, loading };
}
