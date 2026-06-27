/**
 * IdeaList
 *
 * Renders the idea list area: loading spinner, empty state, or the list of
 * IdeaCard rows. Pagination and filters are rendered by the orchestrator.
 */
'use client';
import { Lightbulb, Loader2 } from 'lucide-react';
import type { Theme } from '@/types';
import type { Idea } from './idea-box.types';
import { IdeaCard } from './idea-card';

interface IdeaListProps {
  isLoading: boolean;
  filtered: Idea[];
  paginatedFiltered: Idea[];
  searchQuery: string;
  themes: Theme[];
  isConverting: boolean;
  convertingIdeaId: number | null;
  onConvert: (idea: Idea) => void;
  onEdit: (idea: Idea) => void;
  onDelete: (id: number) => void;
}

/**
 * Render the idea list (loading / empty / populated).
 *
 * @param props - List data and row action handlers from useIdeaBox. / 一覧データと行アクションハンドラ。
 */
export function IdeaList({
  isLoading,
  filtered,
  paginatedFiltered,
  searchQuery,
  themes,
  isConverting,
  convertingIdeaId,
  onConvert,
  onEdit,
  onDelete,
}: IdeaListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lightbulb className="h-12 w-12 text-zinc-200 dark:text-zinc-700 mb-3" />
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {searchQuery ? '検索結果がありません' : 'アイデアがまだありません'}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
          上の「アイデアを追加」ボタンで気軽にメモしましょう
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {paginatedFiltered.map((idea) => (
        <IdeaCard
          key={idea.id}
          idea={idea}
          themes={themes}
          isConverting={isConverting}
          convertingIdeaId={convertingIdeaId}
          onConvert={onConvert}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
