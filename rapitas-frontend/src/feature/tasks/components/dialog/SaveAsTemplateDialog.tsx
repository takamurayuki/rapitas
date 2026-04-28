'use client';

import { useState, useEffect } from 'react';
import { FileStack, X, FolderPlus, Check } from 'lucide-react';
import type { Task, TaskTemplate } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SaveAsTemplateDialog');

// Default categories
const DEFAULT_CATEGORIES = [
  '開発',
  'デザイン',
  'ドキュメント',
  'ミーティング',
  'レビュー',
  '調査',
  'その他',
];

type Props = {
  task: Task;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (template: TaskTemplate) => void;
};

export default function SaveAsTemplateDialog({ task, isOpen, onClose, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [isCustomCategory, setIsCustomCategory] = useState(false);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Set initial values from task info when modal opens
  useEffect(() => {
    if (isOpen && task) {
      setName(task.title);
      setDescription(task.description || '');
      setError(null);
    }
  }, [isOpen, task]);

  // Fetch existing categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/templates/categories`);
        if (res.ok) {
          const data = await res.json();
          // Merge default and existing categories
          const merged = [...new Set([...DEFAULT_CATEGORIES, ...data])];
          setCategories(merged);
        }
      } catch (err) {
        logger.error('Failed to fetch categories:', err);
      }
    };
    if (isOpen) {
      fetchCategories();
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const finalCategory = isCustomCategory ? customCategory : category;

    if (!name.trim()) {
      setError('テンプレート名を入力してください');
      return;
    }
    if (!finalCategory.trim()) {
      setError('カテゴリを選択または入力してください');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE_URL}/templates/from-task/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          category: finalCategory.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'テンプレートの作成に失敗しました');
      }

      const template = await res.json();
      onSuccess?.(template);
      onClose();

      setName('');
      setDescription('');
      setCategory('');
      setCustomCategory('');
      setIsCustomCategory(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <FileStack className="w-5 h-5 text-violet-500" />
            テンプレートとして保存
          </h2>
          <button
            onClick={handleClose}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              テンプレート名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="テンプレート名を入力"
              className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              説明（任意）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="テンプレートの説明を入力"
              rows={3}
              className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              カテゴリ <span className="text-red-500">*</span>
            </label>

            {!isCustomCategory ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                        category === cat
                          ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                      }`}
                    >
                      {category === cat && <Check className="w-3.5 h-3.5 inline mr-1" />}
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomCategory(true);
                    setCategory('');
                  }}
                  className="flex items-center gap-1.5 text-sm text-violet-600 dark:text-violet-400 hover:underline"
                >
                  <FolderPlus className="w-4 h-4" />
                  新しいカテゴリを作成
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="新しいカテゴリ名を入力"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl px-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setIsCustomCategory(false);
                    setCustomCategory('');
                  }}
                  className="text-sm text-zinc-500 hover:underline"
                >
                  既存のカテゴリから選択
                </button>
              </div>
            )}
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-xl p-4">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              テンプレートに含まれる情報
            </h4>
            <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
              <li>• タイトル: {task.title}</li>
              <li>• 優先度: {task.priority}</li>
              {task.estimatedHours && <li>• 見積もり時間: {task.estimatedHours}時間</li>}
              {task.subtasks && task.subtasks.length > 0 && (
                <li>• サブタスク: {task.subtasks.length}件</li>
              )}
              {task.taskLabels && task.taskLabels.length > 0 && (
                <li>• ラベル: {task.taskLabels.length}件</li>
              )}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '保存中...' : 'テンプレートとして保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
