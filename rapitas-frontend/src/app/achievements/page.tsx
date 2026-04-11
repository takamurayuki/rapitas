/**
 * Achievements Page
 *
 * Main page for displaying achievements, statistics, and badges
 * in the rapitas task management system.
 */

import React from 'react';
import type { Metadata } from 'next';
import { AchievementsClient } from './_components/AchievementsClient';

// Mock user ID - in a real app, this would come from authentication
const MOCK_USER_ID = 1;

/**
 * Page metadata
 */
export const metadata: Metadata = {
  title: '実績・統計 | Rapitas',
  description: 'タスク管理と学習進捗の実績・統計を確認できます。',
  keywords: ['実績', '統計', 'タスク管理', '学習進捗', 'ゲーミフィケーション'],
};

/**
 * Achievements page component
 * 実績ページコンポーネント
 */
export default function AchievementsPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AchievementsClient userId={MOCK_USER_ID} />
    </div>
  );
}
