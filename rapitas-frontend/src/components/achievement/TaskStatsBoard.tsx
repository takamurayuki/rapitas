/**
 * Task Stats Board Component
 *
 * Displays comprehensive task statistics and progress analytics
 * for the rapitas task management system.
 */

'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CheckSquare, Clock, Bot, Target, Flame, Calendar,
  TrendingUp, Award, BarChart3, PieChart, Activity
} from 'lucide-react';
import type { PlayerStats } from '../../types/achievement';

interface TaskStatsBoardProps {
  playerStats: PlayerStats;
  className?: string;
}

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  trend?: {
    value: number;
    label: string;
    isPositive: boolean;
  };
}

/**
 * Individual stat card component
 * 個別統計カードコンポーネント
 */
const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  color,
  trend
}) => {
  return (
    <motion.div
      className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg transition-all duration-300"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            <div
              className="p-2 rounded-lg"
              style={{ backgroundColor: `${color}20`, color }}
            >
              {icon}
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {title}
              </h3>
            </div>
          </div>

          <div className="mb-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </span>
            {subtitle && (
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                {subtitle}
              </span>
            )}
          </div>

          {trend && (
            <div className={`flex items-center space-x-1 text-sm ${
              trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            }`}>
              <TrendingUp className={`w-4 h-4 ${!trend.isPositive ? 'transform rotate-180' : ''}`} />
              <span>{trend.value > 0 ? '+' : ''}{trend.value}</span>
              <span className="text-gray-500 dark:text-gray-400">{trend.label}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/**
 * Progress ring component
 * 進捗リングコンポーネント
 */
interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label: string;
  value: string;
}

const ProgressRing: React.FC<ProgressRingProps> = ({
  percentage,
  size = 120,
  strokeWidth = 8,
  color = '#3b82f6',
  label,
  value
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          className="transform -rotate-90"
          width={size}
          height={size}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={strokeWidth}
            fill="none"
            className="dark:stroke-gray-700"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            strokeLinecap="round"
            animate={{ strokeDashoffset: circumference - (percentage / 100) * circumference }}
            transition={{ duration: 2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {Math.round(percentage)}%
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {value}
          </div>
        </div>
      </div>
      <div className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-400 text-center">
        {label}
      </div>
    </div>
  );
};

/**
 * Streak indicator component
 * 連続記録表示コンポーネント
 */
interface StreakIndicatorProps {
  current: number;
  max: number;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const StreakIndicator: React.FC<StreakIndicatorProps> = ({
  current,
  max,
  label,
  icon,
  color
}) => {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="flex items-center space-x-3">
        <div
          className="p-2 rounded-lg"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {icon}
        </div>
        <div className="flex-1">
          <div className="text-sm text-gray-600 dark:text-gray-400">{label}</div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {current}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              / 最高 {max}日
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Main task stats board component
 * メインタスク統計ボードコンポーネント
 */
export const TaskStatsBoard: React.FC<TaskStatsBoardProps> = ({
  playerStats,
  className = ''
}) => {
  const {
    totalTasksCompleted,
    tasksCompletedToday,
    tasksCompletedThisWeek,
    currentTaskStreak,
    maxTaskStreak,
    totalStudyTimeMinutes,
    studyTimeToday,
    studyTimeThisWeek,
    currentStudyStreak,
    maxStudyStreak,
    totalAgentExecutions,
    agentExecutionsToday,
    agentExecutionsThisWeek,
    highPriorityTasksCompleted,
    onTimeCompletionRate
  } = playerStats;

  // Format time duration
  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes}分`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
  };

  // Calculate weekly goals progress
  const weeklyTaskGoal = 20;
  const weeklyStudyGoal = 10 * 60; // 10 hours in minutes
  const weeklyAgentGoal = 10;

  const weeklyProgress = useMemo(() => ({
    tasks: Math.min((tasksCompletedThisWeek / weeklyTaskGoal) * 100, 100),
    study: Math.min((studyTimeThisWeek / weeklyStudyGoal) * 100, 100),
    agents: Math.min((agentExecutionsThisWeek / weeklyAgentGoal) * 100, 100),
  }), [tasksCompletedThisWeek, studyTimeThisWeek, agentExecutionsThisWeek]);

  return (
    <div className={`space-y-8 ${className}`}>
      {/* Overview Stats */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          📊 統計概要
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="総タスク数"
            value={totalTasksCompleted}
            icon={<CheckSquare className="w-5 h-5" />}
            color="#10b981"
            trend={{
              value: tasksCompletedToday,
              label: "今日",
              isPositive: tasksCompletedToday > 0
            }}
          />

          <StatCard
            title="総学習時間"
            value={formatTime(totalStudyTimeMinutes)}
            icon={<Clock className="w-5 h-5" />}
            color="#3b82f6"
            trend={{
              value: studyTimeToday,
              label: `今日 ${formatTime(studyTimeToday)}`,
              isPositive: studyTimeToday > 0
            }}
          />

          <StatCard
            title="エージェント実行"
            value={totalAgentExecutions}
            subtitle="回"
            icon={<Bot className="w-5 h-5" />}
            color="#8b5cf6"
            trend={{
              value: agentExecutionsToday,
              label: "今日",
              isPositive: agentExecutionsToday > 0
            }}
          />

          <StatCard
            title="高優先度タスク"
            value={highPriorityTasksCompleted}
            subtitle={`完了率 ${Math.round(onTimeCompletionRate)}%`}
            icon={<Target className="w-5 h-5" />}
            color="#f59e0b"
          />
        </div>
      </div>

      {/* Weekly Progress */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          📈 今週の進捗
        </h2>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <ProgressRing
              percentage={weeklyProgress.tasks}
              color="#10b981"
              label="タスク完了"
              value={`${tasksCompletedThisWeek}/${weeklyTaskGoal}`}
            />
            <ProgressRing
              percentage={weeklyProgress.study}
              color="#3b82f6"
              label="学習時間"
              value={`${formatTime(studyTimeThisWeek)}`}
            />
            <ProgressRing
              percentage={weeklyProgress.agents}
              color="#8b5cf6"
              label="エージェント"
              value={`${agentExecutionsThisWeek}/${weeklyAgentGoal}`}
            />
          </div>
        </div>
      </div>

      {/* Streaks */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          🔥 連続記録
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StreakIndicator
            current={currentTaskStreak}
            max={maxTaskStreak}
            label="タスク完了連続日数"
            icon={<CheckSquare className="w-5 h-5" />}
            color="#10b981"
          />
          <StreakIndicator
            current={currentStudyStreak}
            max={maxStudyStreak}
            label="学習連続日数"
            icon={<Clock className="w-5 h-5" />}
            color="#3b82f6"
          />
        </div>
      </div>

      {/* Today's Activity */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
          📅 今日のアクティビティ
        </h2>
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">
                {tasksCompletedToday}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                完了タスク
              </div>
            </div>

            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">
                {formatTime(studyTimeToday)}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                学習時間
              </div>
            </div>

            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-1">
                {agentExecutionsToday}
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                エージェント実行
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
              最終更新: {playerStats.lastUpdatedAt.toLocaleString('ja-JP')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};