'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Brain, Plus, BarChart3 } from 'lucide-react';
import { useKnowledge } from '@/feature/knowledge/hooks/useKnowledge';
import { useKnowledgeSearch } from '@/feature/knowledge/hooks/useKnowledgeSearch';
import { useMemoryStats } from '@/feature/knowledge/hooks/useMemoryStats';
import { KnowledgeEntryCard } from '@/feature/knowledge/components/KnowledgeEntryCard';
import { KnowledgeSearchBar } from '@/feature/knowledge/components/KnowledgeSearchBar';
import { KnowledgeFilterPanel } from '@/feature/knowledge/components/KnowledgeFilterPanel';
import { KnowledgeStats } from '@/feature/knowledge/components/KnowledgeStats';
import type {
  KnowledgeCategory,
  ForgettingStage,
  ValidationStatus,
} from '@/feature/knowledge/types';

export default function KnowledgeClient() {
  const t = useTranslations('knowledge');
  const tc = useTranslations('common');

  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<KnowledgeCategory | ''>('');
  const [stage, setStage] = useState<ForgettingStage | ''>('');
  const [validation, setValidation] = useState<ValidationStatus | ''>('');
  const [searchMode, setSearchMode] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<KnowledgeCategory>('general');

  const { entries, total, totalPages, isLoading, createEntry } = useKnowledge({
    page,
    limit: 20,
    category: category || undefined,
    forgettingStage: stage || undefined,
    validationStatus: validation || undefined,
  });

  const { results: searchResults, isSearching, search } = useKnowledgeSearch();
  const { stats } = useMemoryStats();

  const handleSearch = useCallback(
    (query: string) => {
      if (query.trim()) {
        setSearchMode(true);
        search(query);
      } else {
        setSearchMode(false);
      }
    },
    [search],
  );

  const handleCreate = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    await createEntry({
      sourceType: 'user_learning',
      title: newTitle,
      content: newContent,
      category: newCategory,
    });
    setShowCreateModal(false);
    setNewTitle('');
    setNewContent('');
    setNewCategory('general');
  };

  const displayEntries = searchMode
    ? searchResults.map((r) => ({ ...r, similarity: r.similarity }))
    : entries;

  return (
    <div className="mx-auto max-w-6xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
              {t('title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('description')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowStats(!showStats)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            {t('createEntry')}
          </button>
        </div>
      </div>

      {/* Stats */}
      {showStats && stats && (
        <div className="mb-6">
          <KnowledgeStats stats={stats} />
        </div>
      )}

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <KnowledgeSearchBar onSearch={handleSearch} isSearching={isSearching} />
        {!searchMode && (
          <KnowledgeFilterPanel
            category={category}
            stage={stage}
            validation={validation}
            onCategoryChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            onStageChange={(v) => {
              setStage(v);
              setPage(1);
            }}
            onValidationChange={(v) => {
              setValidation(v);
              setPage(1);
            }}
          />
        )}
      </div>

      {/* Results count */}
      <div className="mb-3 text-sm text-gray-500 dark:text-gray-400">
        {searchMode
          ? `${searchResults.length} ${t('entries')}`
          : `${total} ${t('entries')}`}
      </div>

      {/* Entry list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          ))}
        </div>
      ) : displayEntries.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-800">
          <Brain className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('noResults')}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('noResultsDescription')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayEntries.map((entry) => (
            <KnowledgeEntryCard
              key={entry.id}
              entry={entry}
              similarity={
                'similarity' in entry ? (entry as any).similarity : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!searchMode && totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
          >
            {tc('back')}
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
          >
            Next
          </button>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 dark:bg-gray-800">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t('createEntry')}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Title
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('content')}
                </label>
                <textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('category')}
                </label>
                <select
                  value={newCategory}
                  onChange={(e) =>
                    setNewCategory(e.target.value as KnowledgeCategory)
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {(
                    [
                      'general',
                      'procedure',
                      'fact',
                      'pattern',
                      'preference',
                      'insight',
                    ] as KnowledgeCategory[]
                  ).map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || !newContent.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {tc('create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
