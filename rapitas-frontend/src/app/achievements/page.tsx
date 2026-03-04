'use client';
import { useEffect, useState } from 'react';
import type { Achievement } from '@/types';
import {
  Trophy,
  Star,
  Zap,
  Award,
  Crown,
  Flame,
  Clock,
  BookOpen,
  Sun,
  Moon,
  Brain,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('AchievementsPage');

const ICON_MAP: Record<string, LucideIcon> = {
  Star,
  Zap,
  Award,
  Crown,
  Flame,
  Clock,
  BookOpen,
  Trophy,
  Sun,
  Moon,
  Brain,
};

const RARITY_STYLES: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  common: {
    bg: 'bg-zinc-100 dark:bg-zinc-800',
    border: 'border-zinc-300 dark:border-zinc-600',
    text: 'text-zinc-600 dark:text-zinc-400',
  },
  rare: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-300 dark:border-blue-700',
    text: 'text-blue-600 dark:text-blue-400',
  },
  epic: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-300 dark:border-purple-700',
    text: 'text-purple-600 dark:text-purple-400',
  },
  legendary: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-300 dark:border-amber-700',
    text: 'text-amber-600 dark:text-amber-400',
  },
};

const RARITY_LABELS: Record<string, string> = {
  common: 'コモン',
  rare: 'レア',
  epic: 'エピック',
  legendary: 'レジェンダリー',
};

export default function AchievementsPage() {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    fetchAchievements();
  }, []);

  const fetchAchievements = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/achievements`);
      if (res.ok) {
        setAchievements(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch achievements:', e);
    } finally {
      setLoading(false);
    }
  };

  const renderIcon = (iconName: string, size = 24) => {
    const IconComponent = ICON_MAP[iconName] || Trophy;
    return <IconComponent size={size} />;
  };

  const unlockedCount = achievements.filter((a) => a.isUnlocked).length;
  const categories = ['all', ...new Set(achievements.map((a) => a.category))];

  const filteredAchievements =
    filter === 'all'
      ? achievements
      : achievements.filter((a) => a.category === filter);

  const getCategoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      all: 'すべて',
      tasks: 'タスク',
      streak: 'ストリーク',
      study: '学習',
      exam: '試験',
      special: 'スペシャル',
      flashcard: 'フラッシュカード',
    };
    return labels[cat] || cat;
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="h-32 bg-zinc-200 dark:bg-zinc-700 rounded-xl"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              実績
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {unlockedCount} / {achievements.length} 解除済み
            </p>
          </div>
        </div>

        {/* 進捗バー */}
        <div className="hidden sm:block w-48">
          <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-linear-to-r from-amber-400 to-amber-600 transition-all"
              style={{
                width: `${(unlockedCount / achievements.length) * 100}%`,
              }}
            />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 text-right">
            {Math.round((unlockedCount / achievements.length) * 100)}%
          </p>
        </div>
      </div>

      {/* カテゴリフィルター */}
      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === cat
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            {getCategoryLabel(cat)}
          </button>
        ))}
      </div>

      {/* 実績グリッド */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filteredAchievements.map((achievement) => {
          const rarityStyle =
            RARITY_STYLES[achievement.rarity] || RARITY_STYLES.common;

          return (
            <div
              key={achievement.id}
              className={`relative rounded-xl border-2 p-4 transition-all ${
                achievement.isUnlocked
                  ? `${rarityStyle.bg} ${rarityStyle.border}`
                  : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 opacity-50'
              }`}
            >
              {/* レアリティバッジ */}
              <div
                className={`absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium ${rarityStyle.text}`}
              >
                {RARITY_LABELS[achievement.rarity]}
              </div>

              <div className="flex flex-col items-center text-center">
                {/* アイコン */}
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 ${
                    achievement.isUnlocked ? '' : 'bg-zinc-200 dark:bg-zinc-700'
                  }`}
                  style={
                    achievement.isUnlocked
                      ? {
                          backgroundColor: `${achievement.color}20`,
                          color: achievement.color,
                        }
                      : {}
                  }
                >
                  {achievement.isUnlocked ? (
                    renderIcon(achievement.icon, 32)
                  ) : (
                    <Lock className="w-8 h-8 text-zinc-400" />
                  )}
                </div>

                {/* 名前 */}
                <h3
                  className={`font-semibold mb-1 ${
                    achievement.isUnlocked
                      ? 'text-zinc-900 dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {achievement.name}
                </h3>

                {/* 説明 */}
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
                  {achievement.description}
                </p>

                {/* 解除日 */}
                {achievement.isUnlocked && achievement.unlockedAt && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {new Date(achievement.unlockedAt).toLocaleDateString(
                      'ja-JP',
                    )}{' '}
                    解除
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredAchievements.length === 0 && (
        <div className="text-center py-12">
          <Trophy className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">
            このカテゴリの実績はありません
          </p>
        </div>
      )}
    </div>
  );
}
