'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  MessageSquare,
  Plus,
  Save,
  X,
  RotateCcw,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  Shield,
  Search,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SystemPromptsPage');

type SystemPrompt = {
  id: number;
  key: string;
  name: string;
  description: string | null;
  content: string;
  category: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

const CATEGORY_LABELS: Record<string, { labelKey: string; color: string }> = {
  general: {
    labelKey: 'categoryGeneral',
    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
  },
  analysis: {
    labelKey: 'categoryAnalysis',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  },
  optimization: {
    labelKey: 'categoryOptimization',
    color:
      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  },
  agent: {
    labelKey: 'categoryAgent',
    color:
      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  },
  chat: {
    labelKey: 'categoryChat',
    color:
      'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  },
};

export default function SystemPromptsPage() {
  const t = useTranslations('prompts');
  const tc = useTranslations('common');
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchPrompts();
  }, []);

  const fetchPrompts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/system-prompts`);
      if (res.ok) {
        const data = await res.json();
        setPrompts(data);
        // まだデータがない場合はシードを実行
        if (data.length === 0) {
          await seedPrompts();
        }
      }
    } catch (error) {
      logger.error('Failed to fetch system prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const seedPrompts = async () => {
    try {
      await fetch(`${API_BASE_URL}/system-prompts/seed`, { method: 'POST' });
      const res = await fetch(`${API_BASE_URL}/system-prompts`);
      if (res.ok) {
        setPrompts(await res.json());
      }
    } catch (error) {
      logger.error('Failed to seed system prompts:', error);
    }
  };

  const handleSave = async (key: string, updates: Partial<SystemPrompt>) => {
    try {
      const res = await fetch(`${API_BASE_URL}/system-prompts/${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setEditingPrompt(null);
        fetchPrompts();
      }
    } catch (error) {
      logger.error('Failed to update system prompt:', error);
    }
  };

  const handleReset = async (key: string) => {
    if (!confirm(t('confirmReset')))
      return;
    try {
      const res = await fetch(`${API_BASE_URL}/system-prompts/${key}/reset`, {
        method: 'POST',
      });
      if (res.ok) {
        setEditingPrompt(null);
        fetchPrompts();
      }
    } catch (error) {
      logger.error('Failed to reset system prompt:', error);
    }
  };

  const handleDelete = async (key: string) => {
    if (!confirm(t('confirmDelete'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/system-prompts/${key}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchPrompts();
      } else {
        const data = await res.json();
        alert(data.error || tc('deleteFailed'));
      }
    } catch (error) {
      logger.error('Failed to delete system prompt:', error);
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const filteredPrompts = prompts.filter((p) => {
    if (filterCategory !== 'all' && p.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // カテゴリごとにグループ化
  const groupedPrompts = filteredPrompts.reduce(
    (acc, prompt) => {
      if (!acc[prompt.category]) {
        acc[prompt.category] = [];
      }
      acc[prompt.category].push(prompt);
      return acc;
    },
    {} as Record<string, SystemPrompt[]>,
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-3">
              <MessageSquare className="w-7 h-7 text-indigo-500" />
              {t('systemPromptManagement')}
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">
              {t('systemPromptSubtitle')}
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('addPrompt')}
          </button>
        </div>

        {/* フィルター・検索 */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('searchPrompts')}
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterCategory('all')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filterCategory === 'all'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                  : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
              } border border-zinc-200 dark:border-zinc-700`}
            >
              {t('all')}
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, { labelKey }]) => (
              <button
                key={key}
                onClick={() => setFilterCategory(key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  filterCategory === key
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                    : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                } border border-zinc-200 dark:border-zinc-700`}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* プロンプト一覧 */}
        {Object.keys(groupedPrompts).length === 0 ? (
          <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
            <MessageSquare className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {searchQuery
                ? t('noSearchResults')
                : t('noPrompts')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedPrompts).map(
              ([category, categoryPrompts]) => {
                const categoryInfo = CATEGORY_LABELS[category] || {
                  labelKey: category,
                  color:
                    'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
                };

                return (
                  <div key={category}>
                    <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${categoryInfo.color}`}
                      >
                        {t(categoryInfo.labelKey)}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-600">
                        ({categoryPrompts.length})
                      </span>
                    </h2>
                    <div className="space-y-3">
                      {categoryPrompts.map((prompt) => (
                        <PromptCard
                          key={prompt.key}
                          prompt={prompt}
                          isExpanded={expandedKeys.has(prompt.key)}
                          isEditing={editingPrompt?.key === prompt.key}
                          onToggleExpand={() => toggleExpand(prompt.key)}
                          onEdit={() => setEditingPrompt(prompt)}
                          onCancelEdit={() => setEditingPrompt(null)}
                          onSave={(updates) => handleSave(prompt.key, updates)}
                          onReset={() => handleReset(prompt.key)}
                          onDelete={() => handleDelete(prompt.key)}
                          onToggleActive={() =>
                            handleSave(prompt.key, {
                              isActive: !prompt.isActive,
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                );
              },
            )}
          </div>
        )}
      </div>

      {/* 追加モーダル */}
      {showAddModal && (
        <AddPromptModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchPrompts();
          }}
        />
      )}
    </div>
  );
}

function PromptCard({
  prompt,
  isExpanded,
  isEditing,
  onToggleExpand,
  onEdit,
  onCancelEdit,
  onSave,
  onReset,
  onDelete,
  onToggleActive,
}: {
  prompt: SystemPrompt;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (updates: Partial<SystemPrompt>) => void;
  onReset: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}) {
  const t = useTranslations('prompts');
  const tc = useTranslations('common');
  const [editContent, setEditContent] = useState('');
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (isEditing) {
      // Use setTimeout to avoid synchronous setState call
      const timeoutId = setTimeout(() => {
        setEditContent(prompt.content);
        setEditName(prompt.name);
        setEditDescription(prompt.description || '');
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [isEditing, prompt]);

  const categoryInfo = CATEGORY_LABELS[prompt.category] || {
    labelKey: prompt.category,
    color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300',
  };

  return (
    <div
      className={`bg-white dark:bg-zinc-800 rounded-lg border transition-all ${
        prompt.isActive
          ? 'border-zinc-200 dark:border-zinc-700'
          : 'border-zinc-200 dark:border-zinc-700 opacity-60'
      }`}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => !isEditing && onToggleExpand()}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button className="text-zinc-400 dark:text-zinc-500 shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {prompt.name}
              </h3>
              {prompt.isDefault && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded shrink-0">
                  <Shield className="w-3 h-3" />
                  {t('defaultLabel')}
                </span>
              )}
              <span
                className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${categoryInfo.color}`}
              >
                {t(categoryInfo.labelKey)}
              </span>
            </div>
            {prompt.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {prompt.description}
              </p>
            )}
          </div>
        </div>
        <div
          className="flex items-center gap-2 shrink-0 ml-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 有効/無効トグル */}
          <button
            onClick={onToggleActive}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              prompt.isActive ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                prompt.isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 展開コンテンツ */}
      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 p-4">
          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('name')}
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('description')}
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('promptContent')}
                </label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={15}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {prompt.isDefault && (
                    <button
                      onClick={onReset}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('resetToDefault')}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onCancelEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4" />
                    {tc('cancel')}
                  </button>
                  <button
                    onClick={() =>
                      onSave({
                        name: editName,
                        description: editDescription || null,
                        content: editContent,
                      } as Partial<SystemPrompt>)
                    }
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    {tc('save')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-zinc-400 dark:text-zinc-500">
                  {t('keyLabel')}{' '}
                  <code className="px-1 py-0.5 bg-zinc-100 dark:bg-zinc-700 rounded">
                    {prompt.key}
                  </code>
                  <span className="mx-2">|</span>
                  {t('updatedLabel')} {new Date(prompt.updatedAt).toLocaleString('ja-JP')}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onEdit}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    {tc('edit')}
                  </button>
                  {!prompt.isDefault && (
                    <button
                      onClick={onDelete}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      {tc('delete')}
                    </button>
                  )}
                  {prompt.isDefault && (
                    <button
                      onClick={onReset}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {t('reset')}
                    </button>
                  )}
                </div>
              </div>
              <pre className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-lg text-sm text-zinc-800 dark:text-zinc-200 font-mono whitespace-pre-wrap overflow-auto max-h-96 border border-zinc-200 dark:border-zinc-700">
                {prompt.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddPromptModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations('prompts');
  const tc = useTranslations('common');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!key.trim() || !name.trim() || !content.trim()) {
      setError(t('requiredFields'));
      return;
    }

    // キーのバリデーション
    if (!/^[a-z0-9_]+$/.test(key)) {
      setError(t('keyValidation'));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/system-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, name, description, content, category }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || t('addFailed'));
      }
    } catch {
      setError(t('addFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto bg-white dark:bg-zinc-800 rounded-lg shadow-xl">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {t('addSystemPrompt')}
          </h2>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('keyIdentifier')}
                  </label>
                  <input
                    type="text"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={t('keyPlaceholder')}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
                    required
                  />
                  <p className="text-xs text-zinc-400 mt-1">
                    {t('keyHint')}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    {t('category')}
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  >
                    {Object.entries(CATEGORY_LABELS).map(
                      ([value, { labelKey }]) => (
                        <option key={value} value={value}>
                          {t(labelKey)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('name')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {tc('descriptionOptional')}</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('descriptionPlaceholder')}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('promptContent')}
                </label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={10}
                  placeholder={t('contentPlaceholder')}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                  required
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-4">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3 mt-6">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {saving ? tc('adding') : tc('add')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
