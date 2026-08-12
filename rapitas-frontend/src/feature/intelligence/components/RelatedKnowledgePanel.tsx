'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Library, BookOpen, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRelatedKnowledge } from '../hooks/useIntelligence';
import { useDebounce } from '@/hooks/common/useDebounce';

/**
 * Shared quiet-period before the related panels treat typing as "stopped".
 * 500ms interleaved with Japanese IME conversion pauses and refetched
 * mid-sentence; 1200ms clears one conversion pause without feeling stalled.
 * Shared with RelatedSearchMissPanel so both panels settle together.
 */
export const RELATED_PANEL_DEBOUNCE_MS = 1200;

interface RelatedKnowledgePanelProps {
  title: string;
  description?: string | null;
  themeId?: number | null;
}

export function RelatedKnowledgePanel({ title, description, themeId }: RelatedKnowledgePanelProps) {
  const t = useTranslations('intelligence.relatedKnowledgePanel');
  const categoryLabels: Record<string, string> = {
    procedure: t('categoryProcedure'),
    pattern: t('categoryPattern'),
    insight: t('categoryInsight'),
    fact: t('categoryFact'),
    preference: t('categoryPreference'),
    general: t('categoryGeneral'),
  };
  const { entries, loading, search } = useRelatedKnowledge();
  const debouncedTitle = useDebounce(title, RELATED_PANEL_DEBOUNCE_MS);
  const debouncedDescription = useDebounce(description, RELATED_PANEL_DEBOUNCE_MS);
  // useDebounce returns the CURRENT value on the first render, and this panel
  // mounts mid-typing (at the wrapper's 3-char gate) — without this flag the
  // mount render would fire an immediate search while the user is still typing.
  const [mountQuietElapsed, setMountQuietElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMountQuietElapsed(true), RELATED_PANEL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Search only when typing has stopped: one full quiet period since mount
    // AND the debounced values have caught up with the live props.
    if (!mountQuietElapsed) return;
    if (debouncedTitle !== title || debouncedDescription !== description) return;
    search(debouncedTitle, debouncedDescription, themeId);
  }, [
    mountQuietElapsed,
    debouncedTitle,
    debouncedDescription,
    title,
    description,
    themeId,
    search,
  ]);

  // Render only settled results: no results → no DOM. A loading-only box that
  // appears then vanishes on an empty response was the flicker being fixed.
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-900/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Library className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          {t('title')}
        </span>
        {loading && (
          <div className="w-3 h-3 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <div className="space-y-1.5">
        {entries.slice(0, 3).map((entry) => (
          <Link
            key={entry.id}
            href="/knowledge"
            className="flex items-start gap-2 p-2 rounded-md bg-white/80 dark:bg-zinc-800/50 hover:bg-white dark:hover:bg-zinc-800 transition-colors group"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {entry.title}
              </p>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-0.5">
                {entry.content}
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400">
                  {categoryLabels[entry.category] || entry.category}
                </span>
                <span className="text-[10px] text-zinc-500">
                  {t('relevanceScore', { score: Math.round(entry.relevanceScore) })}
                </span>
              </div>
            </div>
            <ExternalLink className="w-3 h-3 text-zinc-300 dark:text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
