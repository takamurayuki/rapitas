/**
 * LinkModal
 *
 * Modal dialog for searching and selecting a target comment to link to.
 * Debounces the search query and displays paginated results with label selection.
 */

'use client';

import { useState, useEffect, memo } from 'react';
import { Link2, Search, X, MessageSquare, Loader2 } from 'lucide-react';
import type { CommentSearchResult } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import type { NoteData } from './comment-types';
import { LABEL_COLORS } from './comment-types';
import { timeAgo } from './comment-types';

type LinkModalProps = {
  source: NoteData;
  taskId: number;
  onSelect: (id: number, label?: string) => void;
  onClose: () => void;
};

/**
 * Full-screen overlay for linking one comment to another.
 *
 * @param props - LinkModalProps
 */
export const LinkModal = memo(function LinkModal({
  source,
  taskId,
  onSelect,
  onClose,
}: LinkModalProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CommentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');

  useEffect(() => {
    const search = async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({
          excludeId: String(source.id),
          taskId: String(taskId),
          limit: '10',
        });
        if (q.trim()) p.set('q', q.trim());
        const res = await fetch(`${API_BASE_URL}/comments/search?${p}`);
        if (res.ok) setResults(await res.json());
      } catch (_) {
        // Search request failed - silently ignore
      } finally {
        setLoading(false);
      }
    };
    // NOTE: 200ms debounce prevents a fetch on every keystroke.
    const t = setTimeout(search, 200);
    return () => clearTimeout(t);
  }, [q, source.id, taskId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 bg-white dark:bg-indigo-dark-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                メモをリンク
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Source preview */}
          <div className="px-2 py-1.5 mb-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-md">
            <p className="text-[10px] text-blue-500 dark:text-blue-400 font-medium mb-0.5">
              リンク元
            </p>
            <p className="text-[10px] text-zinc-600 dark:text-zinc-400 line-clamp-1">
              {source.content}
            </p>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="メモを検索..."
              className="w-full pl-7 pr-3 py-1.5 text-xs bg-zinc-50 dark:bg-indigo-dark-800 border border-zinc-200 dark:border-zinc-700 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30 transition-colors"
              autoFocus
            />
          </div>

          {/* Label buttons */}
          <div className="flex gap-1.5 mt-2">
            {(['関連', '発展', '補足'] as const).map((l) => {
              const style = LABEL_COLORS[l];
              const isActive = label === l;
              return (
                <button
                  key={l}
                  onClick={() => setLabel(isActive ? '' : l)}
                  className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                    isActive
                      ? `${style.bg} ${style.text} ${style.border} font-medium`
                      : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-48 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center">
              <Loader2 className="w-4 h-4 animate-spin mx-auto text-blue-500" />
              <p className="text-[10px] text-zinc-400 mt-1">検索中...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="p-1.5 space-y-0.5">
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.id, label || undefined)}
                  className="w-full flex items-start gap-2 p-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-lg transition-colors group"
                >
                  <MessageSquare className="w-3 h-3 text-zinc-400 group-hover:text-blue-500 shrink-0 mt-0.5 transition-colors" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-700 dark:text-zinc-300 line-clamp-2 leading-relaxed">
                      {r.content}
                    </p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      {timeAgo(new Date(r.createdAt))}
                    </p>
                  </div>
                  <Link2 className="w-3 h-3 text-zinc-300 group-hover:text-blue-500 shrink-0 mt-0.5 transition-colors" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center">
              <Search className="w-5 h-5 text-zinc-300 dark:text-zinc-600 mx-auto mb-1.5" />
              <p className="text-xs text-zinc-400">
                {q ? '一致するメモがありません' : 'リンク先のメモを検索'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
