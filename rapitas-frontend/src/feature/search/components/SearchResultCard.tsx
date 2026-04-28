'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, MessageSquare, FileText, StickyNote, ExternalLink } from 'lucide-react';
import type { SearchResult, SearchResultType } from '@/hooks/search/useGlobalSearch';

const typeConfig: Record<
  SearchResultType,
  { label: string; icon: React.ElementType; color: string; darkColor: string }
> = {
  task: {
    label: 'タスク',
    icon: CheckSquare,
    color: 'bg-blue-100 text-blue-700',
    darkColor: 'dark:bg-blue-900/30 dark:text-blue-400',
  },
  comment: {
    label: 'コメント',
    icon: MessageSquare,
    color: 'bg-amber-100 text-amber-700',
    darkColor: 'dark:bg-amber-900/30 dark:text-amber-400',
  },
  note: {
    label: 'ノート',
    icon: StickyNote,
    color: 'bg-green-100 text-green-700',
    darkColor: 'dark:bg-green-900/30 dark:text-green-400',
  },
  resource: {
    label: 'リソース',
    icon: FileText,
    color: 'bg-purple-100 text-purple-700',
    darkColor: 'dark:bg-purple-900/30 dark:text-purple-400',
  },
};

function highlightExcerpt(excerpt: string, query: string): React.ReactNode {
  if (!query.trim()) return excerpt;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = excerpt.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function getNavigationPath(result: SearchResult): string {
  if (result.type === 'task') {
    return `/tasks/${result.id}`;
  }
  if (result.type === 'comment' || result.type === 'resource') {
    const taskId = (result.metadata as { taskId?: number })?.taskId;
    if (taskId) return `/tasks/${taskId}`;
  }
  return '#';
}

interface SearchResultCardProps {
  result: SearchResult;
  query: string;
}

export default function SearchResultCard({ result, query }: SearchResultCardProps) {
  const router = useRouter();
  const config = typeConfig[result.type];
  const Icon = config.icon;

  const metadata = result.metadata as Record<string, unknown>;
  const status = metadata?.status as string | undefined;
  const priority = metadata?.priority as string | undefined;
  const taskTitle = metadata?.taskTitle as string | undefined;
  const theme = metadata?.theme as { name?: string; color?: string } | undefined;

  return (
    <button
      type="button"
      onClick={() => router.push(getNavigationPath(result))}
      className="w-full text-left group bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-md dark:hover:shadow-lg dark:hover:shadow-black/30 transition-all cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {/* Type icon */}
        <div className={`flex-shrink-0 p-2 rounded-lg ${config.color} ${config.darkColor}`}>
          <Icon className="w-4 h-4" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {result.title}
            </h3>
            <ExternalLink className="w-3.5 h-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </div>

          {/* Excerpt */}
          {result.excerpt && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-2">
              {highlightExcerpt(result.excerpt, query)}
            </p>
          )}

          {/* Metadata badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${config.color} ${config.darkColor}`}
            >
              <Icon className="w-3 h-3" />
              {config.label}
            </span>

            {status && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {status}
              </span>
            )}

            {priority && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                {priority}
              </span>
            )}

            {theme?.name && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-medium text-white"
                style={{ backgroundColor: theme.color || '#6366f1' }}
              >
                {theme.name}
              </span>
            )}

            {taskTitle && result.type !== 'task' && (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400 truncate max-w-[200px]">
                {taskTitle}
              </span>
            )}

            {/* Relevance */}
            <span className="ml-auto text-[10px] text-zinc-400 dark:text-zinc-500">
              関連度 {result.relevance}%
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
