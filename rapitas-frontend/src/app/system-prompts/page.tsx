'use client';

/**
 * SystemPromptsPage
 *
 * Page-level component for managing system prompts.
 * Handles data fetching, filtering, and delegates rendering to sub-components.
 */

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { MessageSquare, Plus, Search } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { CATEGORY_LABELS, type SystemPrompt } from './components/types';
import { PromptCard } from './components/PromptCard';
import { AddPromptModal } from './components/AddPromptModal';

const logger = createLogger('SystemPromptsPage');

export default function SystemPromptsPage() {
  const t = useTranslations('prompts');
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
    if (!confirm(t('confirmReset'))) return;
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
        alert(data.error || t('deleteFailed'));
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

        {Object.keys(groupedPrompts).length === 0 ? (
          <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700">
            <MessageSquare className="w-12 h-12 mx-auto text-zinc-400 mb-4" />
            <p className="text-zinc-500 dark:text-zinc-400">
              {searchQuery ? t('noSearchResults') : t('noPrompts')}
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
