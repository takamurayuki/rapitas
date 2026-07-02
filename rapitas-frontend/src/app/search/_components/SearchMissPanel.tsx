'use client';
/**
 * search/_components/SearchMissPanel.tsx
 *
 * Displays the top open zero-result search queries (SearchMiss) and lets the
 * user create a task to fill that content gap. Passing searchMissId on task
 * creation wires the gap resolution flow end-to-end.
 */

import { useEffect, useState, useCallback } from 'react';
import { Lightbulb, Plus, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SearchMissPanel');

interface SearchMissItem {
  id: number;
  query: string;
  hitCount: number;
  lastSearchedAt: string;
  status: string;
}

/**
 * Panel that surfaces zero-result queries and allows task creation to fill them.
 */
export function SearchMissPanel() {
  const t = useTranslations('search');
  const tCommon = useTranslations('common');
  const [items, setItems] = useState<SearchMissItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<number | null>(null);

  const fetchMisses = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/search/miss?limit=5`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      logger.warn('Failed to fetch search misses', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMisses();
  }, [fetchMisses]);

  const handleCreateTask = async (miss: SearchMissItem) => {
    if (creating !== null) return;
    setCreating(miss.id);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: miss.query,
          status: 'todo',
          priority: 'medium',
          searchMissId: miss.id,
        }),
      });
      if (!res.ok) throw new Error('Failed to create task');
      await fetchMisses();
    } catch (err) {
      logger.error('Failed to create task for search miss', err);
    } finally {
      setCreating(null);
    }
  };

  if (loading) {
    return (
      <div className="mt-6 animate-pulse">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-1/3 mb-3" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-zinc-100 dark:bg-zinc-800 rounded-lg mb-2" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-6 animate-in fade-in-0 duration-200">
      <div className="flex items-center gap-2 mb-3">
        <Lightbulb className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t('missPanel.heading')}
        </h3>
        <button
          onClick={fetchMisses}
          className="ml-auto text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          aria-label={tCommon('update')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        {items.map((miss) => (
          <div
            key={miss.id}
            className="flex items-center justify-between gap-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">
                {miss.query}
              </span>
              <span className="flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                {t('missPanel.hitCount', { count: miss.hitCount })}
              </span>
            </div>
            <button
              onClick={() => handleCreateTask(miss)}
              disabled={creating === miss.id}
              className="flex-shrink-0 flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {creating === miss.id ? t('missPanel.creating') : t('missPanel.createTask')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
