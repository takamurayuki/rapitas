'use client';

import React from 'react';
import { Search } from 'lucide-react';

export interface Suggestion {
  id: number;
  title: string;
  type: 'task' | 'comment' | 'resource';
  status?: string;
}

interface SearchSuggestionsProps {
  query: string;
  suggestions: Suggestion[];
  onSelect: (suggestion: Suggestion) => void;
  loading?: boolean;
}

export default function SearchSuggestions({
  query,
  suggestions,
  onSelect,
  loading = false,
}: SearchSuggestionsProps) {
  if (!query.trim() || (suggestions.length === 0 && !loading)) {
    return null;
  }

  return (
    <div className="absolute z-50 mt-1 w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg dark:shadow-black/40 overflow-hidden">
      {loading ? (
        <div className="px-4 py-3 text-sm text-zinc-400 dark:text-zinc-500">検索中...</div>
      ) : (
        <ul className="max-h-64 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.type}-${suggestion.id}`}>
              <button
                type="button"
                onClick={() => onSelect(suggestion)}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
              >
                <Search className="w-4 h-4 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-zinc-900 dark:text-zinc-100 truncate block">
                    {suggestion.title}
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400 flex-shrink-0">
                  {suggestion.type === 'task'
                    ? 'タスク'
                    : suggestion.type === 'comment'
                      ? 'コメント'
                      : 'リソース'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
