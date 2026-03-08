'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, X } from 'lucide-react';

const STORAGE_KEY = 'rapitas-search-history';
const MAX_HISTORY = 10;

interface SearchHistoryProps {
  onSelect: (query: string) => void;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

export function addToSearchHistory(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const history = loadHistory().filter((h) => h !== trimmed);
  history.unshift(trimmed);
  saveHistory(history);
}

export default function SearchHistory({ onSelect }: SearchHistoryProps) {
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const removeItem = useCallback((item: string) => {
    const updated = history.filter((h) => h !== item);
    saveHistory(updated);
    setHistory(updated);
  }, [history]);

  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase flex items-center gap-1">
        <Clock className="w-3 h-3" />
        最近の検索
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {history.map((item) => (
          <button
            key={item}
            type="button"
            className="group inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 hover:text-indigo-700 dark:hover:text-indigo-400 transition-colors"
            onClick={() => onSelect(item)}
          >
            {item}
            <X
              className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); removeItem(item); }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
