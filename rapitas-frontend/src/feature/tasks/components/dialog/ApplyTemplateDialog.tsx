'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  FileStack,
  X,
  Search,
  Check,
  ChevronRight,
  Clock,
  CheckCircle2,
  Tag,
  SwatchBook,
} from 'lucide-react';
import type { TaskTemplate, Theme } from '@/types';
import { getIconComponent } from '@/components/category/icon-data';
import { API_BASE_URL } from '@/utils/api';
import { SkeletonBlock } from '@/components/ui/LoadingSpinner';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  selectedTheme: Theme | null;
  onApply: (template: TaskTemplate) => void;
};

export default function ApplyTemplateDialog({
  isOpen,
  onClose,
  selectedTheme,
  onApply,
}: Props) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TaskTemplate | null>(
    null,
  );

  useEffect(() => {
    const fetchTemplates = async () => {
      if (!isOpen) return;

      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (selectedTheme) {
          params.append('themeId', selectedTheme.id.toString());
        }

        const res = await fetch(
          `${API_BASE_URL}/templates?${params.toString()}`,
        );
        if (!res.ok) {
          throw new Error('テンプレートの取得に失敗しました');
        }
        const data = await res.json();
        setTemplates(data);

        const uniqueCategories = [
          ...new Set(data.map((t: TaskTemplate) => t.category)),
        ] as string[];
        setCategories(uniqueCategories);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'エラーが発生しました');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTemplates();
  }, [isOpen, selectedTheme]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedCategory(null);
      setSearchQuery('');
      setSelectedTemplate(null);
      setError(null);
    }
  }, [isOpen]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((template) => {
      const matchesCategory =
        !selectedCategory || template.category === selectedCategory;
      const matchesSearch =
        !searchQuery ||
        template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        template.description?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [templates, selectedCategory, searchQuery]);

  const handleApply = () => {
    if (selectedTemplate) {
      onApply(selectedTemplate);
      onClose();
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
        className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <FileStack className="w-5 h-5 text-violet-500" />
              テンプレートを適用
            </h2>
            {selectedTheme && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-1.5">
                {(() => {
                  const ThemeIcon =
                    getIconComponent(selectedTheme.icon || '') || SwatchBook;
                  return (
                    <>
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: selectedTheme.color }}
                      />
                      <ThemeIcon
                        className="w-3.5 h-3.5"
                        style={{ color: selectedTheme.color }}
                      />
                      {selectedTheme.name}のテンプレート
                    </>
                  );
                })()}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter */}
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="テンプレートを検索..."
              className="w-full bg-zinc-50 dark:bg-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm border border-zinc-200 dark:border-zinc-700 outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
            />
          </div>

          {/* Categories */}
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory(null)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  selectedCategory === null
                    ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                すべて
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    selectedCategory === cat
                      ? 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="space-y-4 w-full max-w-md">
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="w-12 h-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <SkeletonBlock className="h-4 w-3/4" />
                    <SkeletonBlock className="h-3 w-1/2" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="w-12 h-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <SkeletonBlock className="h-4 w-2/3" />
                    <SkeletonBlock className="h-3 w-5/6" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <SkeletonBlock className="w-12 h-12 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <SkeletonBlock className="h-4 w-4/5" />
                    <SkeletonBlock className="h-3 w-1/3" />
                  </div>
                </div>
              </div>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="text-center py-12">
              <FileStack className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {templates.length === 0
                  ? selectedTheme
                    ? `${selectedTheme.name}のテンプレートはまだありません`
                    : 'テンプレートがありません'
                  : '条件に一致するテンプレートがありません'}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                タスク詳細画面から「テンプレートとして保存」で作成できます
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    selectedTemplate?.id === template.id
                      ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 ring-2 ring-violet-500/20'
                      : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {template.name}
                        </h3>
                        {selectedTemplate?.id === template.id && (
                          <Check className="w-4 h-4 text-violet-600 dark:text-violet-400 shrink-0" />
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-2">
                          {template.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
                        <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 rounded">
                          {template.category}
                        </span>
                        {template.templateData.estimatedHours && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {template.templateData.estimatedHours}時間
                          </span>
                        )}
                        {template.templateData.subtasks &&
                          template.templateData.subtasks.length > 0 && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              サブタスク{template.templateData.subtasks.length}
                              件
                            </span>
                          )}
                        {template.templateData.labels &&
                          template.templateData.labels.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              ラベル{template.templateData.labels.length}件
                            </span>
                          )}
                        <span className="text-zinc-300 dark:text-zinc-600">
                          使用回数: {template.useCount}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Template Preview (when selected) */}
        {selectedTemplate && (
          <div className="border-t border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
            <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              テンプレートに含まれる情報
            </h4>
            <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
              {selectedTemplate.templateData.title && (
                <li>• タイトル: {selectedTemplate.templateData.title}</li>
              )}
              {selectedTemplate.templateData.priority && (
                <li>• 優先度: {selectedTemplate.templateData.priority}</li>
              )}
              {selectedTemplate.templateData.estimatedHours && (
                <li>
                  • 見積もり時間: {selectedTemplate.templateData.estimatedHours}
                  時間
                </li>
              )}
              {selectedTemplate.templateData.subtasks &&
                selectedTemplate.templateData.subtasks.length > 0 && (
                  <li>
                    • サブタスク:{' '}
                    {selectedTemplate.templateData.subtasks.length}件
                    <ul className="ml-4 mt-1 space-y-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                      {selectedTemplate.templateData.subtasks
                        .slice(0, 3)
                        .map((st, idx) => (
                          <li key={idx}>- {st.title}</li>
                        ))}
                      {selectedTemplate.templateData.subtasks.length > 3 && (
                        <li>
                          ...他{' '}
                          {selectedTemplate.templateData.subtasks.length - 3}件
                        </li>
                      )}
                    </ul>
                  </li>
                )}
              {selectedTemplate.templateData.labels &&
                selectedTemplate.templateData.labels.length > 0 && (
                  <li>
                    • ラベル: {selectedTemplate.templateData.labels.join(', ')}
                  </li>
                )}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!selectedTemplate}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            テンプレートを適用
          </button>
        </div>
      </div>
    </div>
  );
}
