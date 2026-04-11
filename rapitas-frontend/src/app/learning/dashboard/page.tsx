'use client';

/**
 * Learning Dashboard Page
 *
 * Unified view aggregating ExamGoal progress, Flashcard stats,
 * LearningGoal tracking, and StudyStreak data from
 * GET /learning/dashboard API.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  BookOpen,
  Target,
  Flame,
  Calendar,
  Brain,
  TrendingUp,
  Clock,
  CheckCircle2,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

interface ExamGoalData {
  id: number;
  name: string;
  examDate: string;
  targetScore: string | null;
  isCompleted: boolean;
  color: string;
  daysRemaining: number;
  taskCount: number;
  completedTaskCount: number;
  progressPercent: number;
}

interface FlashcardStats {
  totalDecks: number;
  totalCards: number;
  dueToday: number;
  reviewedToday: number;
  masteredCards: number;
  averageRetention: number;
}

interface LearningGoalData {
  id: number;
  title: string;
  currentLevel: string | null;
  targetLevel: string | null;
  deadline: string | null;
  dailyHours: number;
  status: string;
  isApplied: boolean;
  progressPercent: number;
}

interface StudyStreakData {
  currentStreak: number;
  longestStreak: number;
  todayMinutes: number;
  todayTasksCompleted: number;
  weeklyMinutes: number;
  weeklyHistory: Array<{ date: string; minutes: number; tasks: number }>;
}

interface DashboardData {
  examGoals: ExamGoalData[];
  flashcards: FlashcardStats;
  learningGoals: LearningGoalData[];
  studyStreak: StudyStreakData;
}

export default function LearningDashboardPage() {
  const t = useTranslations('common');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/learning/dashboard`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // Degrade gracefully
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-center text-zinc-500">{t('error')}</div>;
  }

  const { examGoals, flashcards, learningGoals, studyStreak } = data;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
        <Brain className="w-7 h-7 text-indigo-500" />
        Learning Dashboard
      </h1>

      {/* Study Streak Banner */}
      <div className="bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Flame className="w-10 h-10" />
            <div>
              <div className="text-3xl font-bold">
                {studyStreak.currentStreak}
              </div>
              <div className="text-sm opacity-90">day streak</div>
            </div>
          </div>
          <div className="h-12 w-px bg-white/30 hidden sm:block" />
          <div className="flex gap-6 text-sm">
            <div>
              <div className="font-semibold text-lg">
                {studyStreak.todayMinutes}min
              </div>
              <div className="opacity-80">today</div>
            </div>
            <div>
              <div className="font-semibold text-lg">
                {studyStreak.todayTasksCompleted}
              </div>
              <div className="opacity-80">tasks done</div>
            </div>
            <div>
              <div className="font-semibold text-lg">
                {studyStreak.weeklyMinutes}min
              </div>
              <div className="opacity-80">this week</div>
            </div>
            <div>
              <div className="font-semibold text-lg">
                {studyStreak.longestStreak}
              </div>
              <div className="opacity-80">best streak</div>
            </div>
          </div>
        </div>

        {/* Weekly mini heatmap */}
        <div className="flex gap-1 mt-4">
          {studyStreak.weeklyHistory.map((day) => {
            const intensity = Math.min(1, day.minutes / 60);
            return (
              <div
                key={day.date}
                className="flex-1 h-2 rounded-full"
                style={{
                  backgroundColor: `rgba(255,255,255,${0.15 + intensity * 0.85})`,
                }}
                title={`${day.date}: ${day.minutes}min, ${day.tasks} tasks`}
              />
            );
          })}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<BookOpen className="w-5 h-5 text-blue-500" />}
          label="Flashcards"
          value={flashcards.totalCards}
          sub={`${flashcards.dueToday} due today`}
        />
        <StatCard
          icon={<CheckCircle2 className="w-5 h-5 text-green-500" />}
          label="Reviewed Today"
          value={flashcards.reviewedToday}
          sub={`${flashcards.masteredCards} mastered`}
        />
        <StatCard
          icon={<Target className="w-5 h-5 text-purple-500" />}
          label="Exam Goals"
          value={examGoals.length}
          sub={`${examGoals.filter((g) => !g.isCompleted).length} active`}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-indigo-500" />}
          label="Retention"
          value={`${flashcards.averageRetention}%`}
          sub="average"
        />
      </div>

      {/* Exam Goals */}
      {examGoals.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Exam Goals
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {examGoals
              .filter((g) => !g.isCompleted)
              .map((goal) => (
                <div
                  key={goal.id}
                  className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {goal.name}
                    </h3>
                    <span
                      className="text-xs px-2 py-1 rounded-full font-medium"
                      style={{
                        backgroundColor: goal.color + '20',
                        color: goal.color,
                      }}
                    >
                      {goal.daysRemaining}d remaining
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                    {goal.targetScore && (
                      <span>Target: {goal.targetScore}</span>
                    )}
                    <span>
                      {goal.completedTaskCount}/{goal.taskCount} tasks
                    </span>
                  </div>
                  <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${goal.progressPercent}%`,
                        backgroundColor: goal.color,
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Learning Goals */}
      {learningGoals.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Learning Goals
          </h2>
          <div className="space-y-3">
            {learningGoals
              .filter((g) => g.status === 'active')
              .map((goal) => (
                <div
                  key={goal.id}
                  className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
                      {goal.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Clock className="w-3.5 h-3.5" />
                      {goal.dailyHours}h/day
                    </div>
                  </div>
                  {(goal.currentLevel || goal.targetLevel) && (
                    <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">
                      {goal.currentLevel} → {goal.targetLevel}
                    </div>
                  )}
                  <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-indigo-500 transition-all"
                      style={{ width: `${goal.progressPercent}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Reusable stat card component. */
function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{sub}</div>
    </div>
  );
}
