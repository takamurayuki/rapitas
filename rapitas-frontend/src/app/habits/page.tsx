'use client';
import { useEffect, useState } from 'react';
import type { Habit } from '@/types';
import Link from 'next/link';
import { Plus, Edit2, Trash2, Check, Target, Flame, Clock } from 'lucide-react';
import { getIconComponent } from '@/components/category/IconData';
import { API_BASE_URL } from '@/utils/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('HabitsPage');

const PRESET_COLORS = [
  '#10B981',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#EF4444',
  '#06B6D4',
  '#84CC16',
];

export default function HabitsPage() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    icon: '',
    color: '#10B981',
    targetCount: 1,
  });

  useEffect(() => {
    fetchHabits();
  }, []);

  const fetchHabits = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/habits`);
      if (res.ok) {
        setHabits(await res.json());
      }
    } catch (e) {
      logger.error('Failed to fetch habits:', e);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingHabit(null);
    setFormData({
      name: '',
      description: '',
      icon: '',
      color: '#10B981',
      targetCount: 1,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (habit: Habit) => {
    setEditingHabit(habit);
    setFormData({
      name: habit.name,
      description: habit.description || '',
      icon: habit.icon || '',
      color: habit.color,
      targetCount: habit.targetCount,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    try {
      const url = editingHabit
        ? `${API_BASE_URL}/habits/${editingHabit.id}`
        : `${API_BASE_URL}/habits`;
      const method = editingHabit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          icon: formData.icon || null,
          color: formData.color,
          targetCount: formData.targetCount,
        }),
      });

      if (res.ok) {
        fetchHabits();
        setIsModalOpen(false);
      }
    } catch (e) {
      logger.error('Failed to save habit:', e);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('この習慣を削除しますか？')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/habits/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchHabits();
      }
    } catch (e) {
      logger.error('Failed to delete habit:', e);
    }
  };

  const handleLog = async (habitId: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/habits/${habitId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchHabits();
      }
    } catch (e) {
      logger.error('Failed to log habit:', e);
    }
  };

  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || '');
    if (!IconComponent) {
      return <Target size={size} />;
    }
    return <IconComponent size={size} />;
  };

  const getTodayCount = (habit: Habit) => {
    return habit.logs?.[0]?.count || 0;
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Flame className="w-8 h-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              習慣トラッカー
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              毎日の習慣を記録して継続力をアップ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/habits/daily-schedule"
            className="flex items-center gap-2 px-4 py-2 border border-indigo-300 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            <Clock className="w-5 h-5" />
            <span>一日のスケジュール</span>
          </Link>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>新規作成</span>
          </button>
        </div>
      </div>

      {/* 習慣リスト */}
      <div className="space-y-3">
        {habits.map((habit) => {
          const todayCount = getTodayCount(habit);
          const isCompleted = todayCount >= habit.targetCount;

          return (
            <div
              key={habit.id}
              className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                isCompleted
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                  : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {/* チェックボタン */}
              <button
                onClick={() => handleLog(habit.id)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isCompleted
                    ? 'bg-emerald-500 text-white'
                    : 'border-2 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                }`}
                style={
                  !isCompleted
                    ? { borderColor: habit.color, color: habit.color }
                    : {}
                }
              >
                {isCompleted ? (
                  <Check className="w-6 h-6" />
                ) : (
                  renderIcon(habit.icon, 24)
                )}
              </button>

              {/* 習慣情報 */}
              <div className="flex-1">
                <h3
                  className={`font-semibold ${
                    isCompleted
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-zinc-900 dark:text-zinc-50'
                  }`}
                >
                  {habit.name}
                </h3>
                {habit.description && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {habit.description}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    今日: {todayCount} / {habit.targetCount}
                  </span>
                  {habit._count && (
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">
                      ・累計 {habit._count.logs} 回
                    </span>
                  )}
                </div>
              </div>

              {/* 進捗バー */}
              <div className="hidden sm:block w-24">
                <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min((todayCount / habit.targetCount) * 100, 100)}%`,
                      backgroundColor: isCompleted ? '#10B981' : habit.color,
                    }}
                  />
                </div>
              </div>

              {/* アクションボタン */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEditModal(habit)}
                  className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(habit.id)}
                  className="p-2 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {habits.length === 0 && (
        <div className="text-center py-12">
          <Flame className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">
            習慣がありません。新規作成から追加してください。
          </p>
        </div>
      )}

      {/* モーダル */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md">
            <div className="p-6">
              <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
                {editingHabit ? '習慣を編集' : '新しい習慣'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    習慣名 *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    placeholder="例: 読書、運動、瞑想"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    1日の目標回数
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.targetCount}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        targetCount: parseInt(e.target.value) || 1,
                      })
                    }
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    説明（任意）
                  </label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) =>
                      setFormData({ ...formData, description: e.target.value })
                    }
                    placeholder="簡単な説明"
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    カラー
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          formData.color === color
                            ? 'border-zinc-900 dark:border-white scale-110'
                            : 'border-transparent hover:scale-105'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                  >
                    {editingHabit ? '更新' : '作成'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
