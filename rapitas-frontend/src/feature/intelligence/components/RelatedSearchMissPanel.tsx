'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SearchX } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useDebounce } from '@/hooks/common/useDebounce';
import { RELATED_PANEL_DEBOUNCE_MS } from './RelatedKnowledgePanel';

const log = createLogger('RelatedSearchMissPanel');

/** One past zero-result search relevant to the draft task. */
interface SearchMissItem {
  id: number;
  query: string;
  hitCount: number;
}

interface RelatedSearchMissPanelProps {
  /** Draft task title. / 下書きタスクのタイトル */
  title: string;
  /** Draft task description (optional). / 下書きタスクの説明（任意） */
  description?: string | null;
}

/**
 * Surfaces past failed (zero-result) searches in the same resource area as the
 * task being created, so the author can avoid pitfalls others hit. Backed by
 * GET /search/miss/related; renders nothing when there are no related misses.
 */
export function RelatedSearchMissPanel({ title, description }: RelatedSearchMissPanelProps) {
  const t = useTranslations('intelligence.relatedSearchMissPanel');
  const [items, setItems] = useState<SearchMissItem[]>([]);
  const [loading, setLoading] = useState(false);
  const text = [title, description ?? ''].join(' ').trim();
  const debouncedText = useDebounce(text, RELATED_PANEL_DEBOUNCE_MS);
  // useDebounce returns the CURRENT value on the first render, and this panel
  // mounts mid-typing (at the wrapper's 3-char gate) — without this flag the
  // mount render would fire an immediate fetch while the user is still typing.
  const [mountQuietElapsed, setMountQuietElapsed] = useState(false);
  // Responses are unordered; only the latest request may write state.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setMountQuietElapsed(true), RELATED_PANEL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Fetch only when typing has stopped: one full quiet period since mount
    // AND the debounced text has caught up with the live props.
    if (!mountQuietElapsed || debouncedText !== text) return;
    const requestId = ++requestIdRef.current;
    if (debouncedText.length < 3) {
      setItems([]);
      setLoading(false);
      return;
    }
    // NOTE: items are intentionally NOT cleared here — previous results stay
    // visible while the refresh is in flight (anti-flicker).
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/search/miss/related?q=${encodeURIComponent(debouncedText)}&limit=5`,
        );
        const data = await res.json();
        if (requestId === requestIdRef.current) {
          setItems(data?.success && Array.isArray(data.items) ? data.items : []);
        }
      } catch (err) {
        // Auxiliary panel: keep the previous items on failure, log only.
        log.error('Failed to load related search misses', err);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [mountQuietElapsed, debouncedText, text]);

  // Render only settled results: no results → no DOM (anti-flicker).
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <SearchX className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">{t('title')}</span>
        {loading && (
          <div className="w-3 h-3 border-2 border-amber-300 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <p className="text-[10px] text-amber-600/80 dark:text-amber-400/70 mb-2">
        {t('description')}
      </p>

      <div className="space-y-1.5">
        {items.slice(0, 5).map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 p-2 rounded-md bg-white/80 dark:bg-zinc-800/50"
          >
            <SearchX className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <p className="flex-1 min-w-0 text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
              {item.query}
            </p>
            <span className="text-[10px] text-amber-600 dark:text-amber-400 shrink-0">
              {t('failCount', { count: item.hitCount })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
