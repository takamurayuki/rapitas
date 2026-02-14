'use client';

import { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { X } from 'lucide-react';
import type { FavoriteLink, CreateFavoriteLinkData } from '@/types/favorite-link';
import { DEFAULT_COLORS } from '@/types/favorite-link';

interface FavoriteLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateFavoriteLinkData) => Promise<void>;
  link?: FavoriteLink;
  mode: 'create' | 'edit';
}

export function FavoriteLinkModal({ isOpen, onClose, onSave, link, mode }: FavoriteLinkModalProps) {
  const [formData, setFormData] = useState<CreateFavoriteLinkData>({
    title: '',
    url: '',
    description: '',
    color: DEFAULT_COLORS[0],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (mode === 'edit' && link) {
      setFormData({
        title: link.title,
        url: link.url,
        description: link.description || '',
        color: link.color,
      });
    } else if (mode === 'create') {
      // Reset form for create mode
      setFormData({
        title: '',
        url: '',
        description: '',
        color: DEFAULT_COLORS[0],
      });
    }
  }, [link, mode, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.url) {
      return;
    }

    // タイトルが空の場合でも、そのまま送信（ドメインを自動入力しない）
    let finalData = { ...formData };
    if (!finalData.title) {
      finalData.title = ''; // 明示的に空文字を設定
    }

    setIsSubmitting(true);
    try {
      await onSave(finalData);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle URL change without auto-filling title
  const handleUrlChange = async (url: string) => {
    setFormData(prev => ({ ...prev, url }));
    // タイトルの自動補完は行わない
  };

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="w-full max-w-2xl bg-white dark:bg-indigo-dark-900 rounded-xl shadow-xl">
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-indigo-dark-700">
            <Dialog.Title className="text-xl font-semibold text-gray-900 dark:text-white">
              {mode === 'create' ? 'お気に入りリンクを追加' : 'お気に入りリンクを編集'}
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-indigo-dark-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => handleUrlChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-indigo-dark-700 rounded-lg bg-white dark:bg-indigo-dark-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                required
                placeholder="https://example.com"
              />
            </div>

            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                タイトル（任意）
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-indigo-dark-700 rounded-lg bg-white dark:bg-indigo-dark-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                placeholder="お気に入りのタイトルを入力"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                説明
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-indigo-dark-700 rounded-lg bg-white dark:bg-indigo-dark-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                rows={2}
                placeholder="このリンクの説明を入力"
              />
            </div>


            {/* Actions */}
            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-indigo-dark-800 rounded-lg transition-colors"
                disabled={isSubmitting}
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                disabled={isSubmitting || !formData.url}
              >
                {isSubmitting ? '保存中...' : mode === 'create' ? '追加' : '更新'}
              </button>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}