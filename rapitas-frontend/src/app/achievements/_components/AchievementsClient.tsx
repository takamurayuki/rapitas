// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — Achievement feature is scaffolded but not yet complete. Remove when implementing.
/**
 * Achievements Client Component
 *
 * Main client-side component for the achievements page
 * in the rapitas task management system.
 */

'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, BarChart3, Gift, RefreshCw, Bell, BellOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  AchievementPanel,
  TaskStatsBoard,
  AchievementToast,
} from '../../../components/achievement';
import { useAchievements } from '../../../hooks/use-achievements';
import { useTaskStats } from '../../../hooks/use-task-stats';
import { formatDateTime } from '@/utils/date';

interface AchievementsClientProps {
  userId: number;
}

type TabType = 'achievements' | 'stats' | 'badges';

/**
 * Main achievements client component
 * メイン実績クライアントコンポーネント
 */
export const AchievementsClient: React.FC<AchievementsClientProps> = ({ userId }) => {
  const t = useTranslations('achievements');
  const tCommon = useTranslations('common');
  const [activeTab, setActiveTab] = useState<TabType>('achievements');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // Hooks
  const {
    achievements,
    progress,
    notifications,
    playerStats,
    totalPoints,
    unlockedCount,
    totalCount,
    completionPercentage,
    isLoading,
    isError,
    markNotificationAsShown,
    clearNotifications,
    refreshAchievements,
  } = useAchievements({ userId });

  const { recentAchievements, isTracking } = useTaskStats({ userId });

  // Loading state
  if (isLoading && !playerStats) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-8">
            <div className="h-8 bg-gray-300 dark:bg-gray-700 rounded w-1/3" />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-gray-300 dark:bg-gray-700 rounded-xl" />
              ))}
            </div>
            <div className="h-96 bg-gray-300 dark:bg-gray-700 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <Trophy className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-2">
            {t('client.loadFailed')}
          </h2>
          <button
            onClick={() => refreshAchievements()}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{tCommon('retry')}</span>
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    {
      id: 'achievements',
      label: t('client.tabs.achievements'),
      icon: Trophy,
      count: unlockedCount,
    },
    { id: 'stats', label: t('client.tabs.stats'), icon: BarChart3 },
    { id: 'badges', label: t('client.tabs.badges'), icon: Gift, count: 0 }, // TODO: Implement badges count
  ] as const;

  const handleTabClick = (tabId: TabType) => {
    setActiveTab(tabId);
  };

  const handleAchievementClick = (_achievement: unknown) => {
    // TODO: Show achievement detail modal
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Toast notifications */}
      {notificationsEnabled && (
        <AchievementToast
          notifications={notifications}
          onDismiss={() => {}}
          onMarkAsShown={markNotificationAsShown}
          maxVisible={3}
          autoHideDuration={5000}
          position="top-right"
        />
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <motion.h1
              className="text-3xl font-bold text-gray-900 dark:text-white mb-2"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {t('client.headerTitle')}
            </motion.h1>
            <motion.p
              className="text-gray-600 dark:text-gray-400"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              {t('client.headerSubtitle')}
            </motion.p>
          </div>

          <div className="flex items-center space-x-3 mt-4 md:mt-0">
            {/* Notification toggle */}
            <button
              onClick={() => setNotificationsEnabled(!notificationsEnabled)}
              className={`p-2 rounded-lg transition-colors ${
                notificationsEnabled
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
              }`}
              title={
                notificationsEnabled
                  ? t('client.disableNotifications')
                  : t('client.enableNotifications')
              }
            >
              {notificationsEnabled ? (
                <Bell className="w-5 h-5" />
              ) : (
                <BellOff className="w-5 h-5" />
              )}
            </button>

            {/* Refresh button */}
            <button
              onClick={() => refreshAchievements()}
              disabled={isLoading}
              className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
              title={t('client.refreshTitle')}
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>

            {/* Clear notifications */}
            {notifications.length > 0 && (
              <button
                onClick={clearNotifications}
                className="px-3 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
              >
                {t('client.clearNotifications')}
              </button>
            )}
          </div>
        </div>

        {/* Quick stats */}
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {unlockedCount}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('client.stats.unlockedCount')}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {Math.round(completionPercentage)}%
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('client.stats.completionRate')}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
              {/* NOTE: numeric thousands-separator display, not a date — out of scope for #847 */}
              {totalPoints.toLocaleString()}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('client.stats.points')}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {playerStats?.totalTasksCompleted || 0}
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {t('client.stats.totalTasks')}
            </div>
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div
          className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id as TabType)}
                className={`flex items-center space-x-2 px-6 py-4 font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                <span>{tab.label}</span>
                {tab.count !== undefined && (
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      activeTab === tab.id
                        ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
                {activeTab === tab.id && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400"
                    layoutId="activeTab"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-6">
            <AnimatePresence mode="wait">
              {activeTab === 'achievements' && (
                <motion.div
                  key="achievements"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <AchievementPanel
                    achievements={achievements}
                    progress={progress}
                    unlockedCount={unlockedCount}
                    totalCount={totalCount}
                    totalPoints={totalPoints}
                    onAchievementClick={handleAchievementClick}
                  />
                </motion.div>
              )}

              {activeTab === 'stats' && playerStats && (
                <motion.div
                  key="stats"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <TaskStatsBoard playerStats={playerStats} />
                </motion.div>
              )}

              {activeTab === 'badges' && (
                <motion.div
                  key="badges"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                  className="text-center py-12"
                >
                  <Gift className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-600 dark:text-gray-400 mb-2">
                    {t('client.badgesComingSoonTitle')}
                  </h3>
                  <p className="text-gray-500 dark:text-gray-500">
                    {t('client.badgesComingSoonHint')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Recent activity */}
        {recentAchievements.length > 0 && (
          <motion.div
            className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {t('client.recentActivityTitle')}
            </h3>
            <div className="flex flex-wrap gap-2">
              {recentAchievements.map((achievementId, index) => (
                <motion.div
                  key={achievementId}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 rounded-full text-sm font-medium"
                >
                  {achievementId.replace(/_/g, ' ')}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Debug info (development only) */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
            <h4 className="font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
              {t('client.devInfoTitle')}
            </h4>
            <div className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
              <div>User ID: {userId}</div>
              <div>Tracking: {isTracking ? 'Active' : 'Inactive'}</div>
              <div>Notifications: {notifications.length} pending</div>
              <div>
                Last update:{' '}
                {playerStats?.lastUpdatedAt ? formatDateTime(playerStats.lastUpdatedAt) : ''}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
