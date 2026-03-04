'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ExamGoal, StudyStreak } from '@/types';
import {
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  Target,
  TrendingUp,
  Award,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import BurnupChart from '@/components/BurnupChart';
import { ExamCountdown } from '@/components/exam-countdown/ExamCountdown';

type OverviewStats = {
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

type DailyStudy = {
  date: string;
  hours: number;
};

type StreakInfo = {
  currentStreak: number;
  longestStreak: number;
  today: string;
};

export default function DashboardPage() {
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
      console.error('Failed to fetch overview:', e);
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
      console.error('Failed to fetch daily study:', e);
    }
  }, []);

  const fetchStreakInfo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/study-streaks/current`);
      if (res.ok) {
        setStreakInfo(await res.json());
      }
    } catch (e) {
      console.error('Failed to fetch streak info:', e);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      await Promise.all([
        fetchOverview(),
        fetchDailyStudy(),
        fetchStreakInfo(),
      ]);
      setLoading(false);
    };

    loadData();
  }, [fetchOverview, fetchDailyStudy, fetchStreakInfo]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
  };

  const maxHours = Math.max(...dailyStudy.map((d) => d.hours), 1);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl"
              />
            ))}
          </div>
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-8 h-8 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            ダッシュボード
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            学習の進捗と統計を確認
          </p>
        </div>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* ストリーク */}
        <div className="bg-linear-to-br from-orange-500 to-red-500 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-2">
            <Flame className="w-8 h-8" />
            <span className="text-xs opacity-75">連続記録</span>
          </div>
          <div className="text-3xl font-bold mb-1">
            {streakInfo?.currentStreak || 0}日
          </div>
          <p className="text-sm opacity-75">
            最長: {streakInfo?.longestStreak || 0}日
          </p>
        </div>

        {/* 今日の完了 */}
        <div className="bg-linear-to-br from-emerald-500 to-teal-500 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle2 className="w-8 h-8" />
            <span className="text-xs opacity-75">今日</span>
          </div>
          <div className="text-3xl font-bold mb-1">
            {overview?.tasks.todayCompleted || 0}
          </div>
          <p className="text-sm opacity-75">タスク完了</p>
        </div>

        {/* 週間学習時間 */}
        <div className="bg-linear-to-br from-blue-500 to-indigo-500 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-2">
            <Clock className="w-8 h-8" />
            <span className="text-xs opacity-75">今週</span>
          </div>
          <div className="text-3xl font-bold mb-1">
            {overview?.studyTime.weekHours || 0}h
          </div>
          <p className="text-sm opacity-75">学習時間</p>
        </div>

        {/* 全体進捗 */}
        <div className="bg-linear-to-br from-violet-500 to-purple-500 rounded-xl p-4 text-white">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-8 h-8" />
            <span className="text-xs opacity-75">全体</span>
          </div>
          <div className="text-3xl font-bold mb-1">
            {overview?.tasks.completionRate || 0}%
          </div>
          <p className="text-sm opacity-75">
            {overview?.tasks.completed || 0}/{overview?.tasks.total || 0} 完了
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 学習時間グラフ */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            過去2週間の学習時間
          </h2>

          {dailyStudy.length > 0 ? (
            <div className="space-y-2">
              {/* グラフ */}
              <div className="flex items-end justify-between h-40 gap-1">
                {dailyStudy.map((day, index) => {
                  const height =
                    day.hours > 0 ? (day.hours / maxHours) * 100 : 2;
                  const isToday = index === dailyStudy.length - 1;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center"
                    >
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isToday
                            ? 'bg-indigo-500'
                            : day.hours > 0
                              ? 'bg-indigo-300 dark:bg-indigo-600'
                              : 'bg-zinc-200 dark:bg-zinc-700'
                        }`}
                        style={{ height: `${height}%` }}
                        title={`${day.hours}時間`}
                      />
                    </div>
                  );
                })}
              </div>

              {/* ラベル */}
              <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400 pt-2 border-t border-zinc-100 dark:border-zinc-700">
                {dailyStudy.map((day, index) => (
                  <div key={day.date} className="flex-1 text-center">
                    {index % 2 === 0 && formatDate(day.date)}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400 mt-2">
                <span>
                  合計:{' '}
                  {dailyStudy.reduce((sum, d) => sum + d.hours, 0).toFixed(1)}
                  時間
                </span>
                <span>
                  平均:{' '}
                  {(
                    dailyStudy.reduce((sum, d) => sum + d.hours, 0) /
                    dailyStudy.length
                  ).toFixed(1)}
                  時間/日
                </span>
              </div>
            </div>
          ) : (
            <div className="h-40 flex items-center justify-center text-zinc-400 dark:text-zinc-500">
              学習記録がありません
            </div>
          )}
        </div>

        {/* 試験カウントダウン */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5" />
            直近の試験
          </h2>

          {overview?.upcomingExams && overview.upcomingExams.length > 0 ? (
            <div className="space-y-3">
              {overview.upcomingExams.slice(0, 3).map((exam) => (
                <div
                  key={exam.id}
                  className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                      {exam.name}
                    </span>
                    {exam.targetScore && (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        目標: {exam.targetScore}
                      </span>
                    )}
                  </div>
                  <ExamCountdown
                    examDate={exam.examDate}
                    color={exam.color}
                    compact
                  />
                </div>
              ))}

              {overview.upcomingExams.length > 3 && (
                <a
                  href="/exam-goals"
                  className="block text-center text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  他 {overview.upcomingExams.length - 3} 件を表示
                </a>
              )}
            </div>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
              <Target className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">試験目標がありません</p>
              <a
                href="/exam-goals"
                className="mt-2 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                試験目標を追加
              </a>
            </div>
          )}
        </div>
      </div>

      {/* 週間サマリー */}
      <div className="mt-6 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
          <Award className="w-5 h-5" />
          今週のサマリー
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">
              {overview?.tasks.weekCompleted || 0}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              完了タスク
            </div>
          </div>

          <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">
              {overview?.studyTime.weekHours || 0}h
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              学習時間
            </div>
          </div>

          <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">
              {streakInfo?.currentStreak || 0}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              連続日数
            </div>
          </div>

          <div className="text-center p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50">
            <div className="text-2xl font-bold text-zinc-800 dark:text-zinc-200">
              {overview?.upcomingExams?.length || 0}
            </div>
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              控えている試験
            </div>
          </div>
        </div>
      </div>

      {/* バーンアップチャート */}
      <div className="mt-4">
        <BurnupChart days={14} />
      </div>
    </div>
  );
}
