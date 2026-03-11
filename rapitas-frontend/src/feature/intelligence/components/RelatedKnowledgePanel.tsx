'use client';

import { useEffect, useRef } from 'react';
import { Lightbulb, BookOpen, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useRelatedKnowledge } from '../hooks/useIntelligence';

interface RelatedKnowledgePanelProps {
  title: string;
  description?: string | null;
  themeId?: number | null;
}

const categoryLabels: Record<string, string> = {
  procedure: '手順',
  pattern: 'パターン',
  insight: '知見',
  fact: '事実',
  preference: '設定',
  general: '一般',
};

export function RelatedKnowledgePanel({
  title,
  description,
  themeId,
}: RelatedKnowledgePanelProps) {
  const { entries, loading, search } = useRelatedKnowledge();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      search(title, description, themeId);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [title, description, themeId, search]);

  if (!loading && entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-900/10 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Lightbulb className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          関連ナレッジ
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
                <span className="text-[10px] text-zinc-400">
                  関連度: {Math.round(entry.relevanceScore)}%
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
