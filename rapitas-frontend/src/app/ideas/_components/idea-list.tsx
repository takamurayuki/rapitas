/**
 * IdeaList
 *
 * Renders the idea list area: loading spinner, empty state, or the list of
 * IdeaCard rows. Pagination and filters are rendered by the orchestrator.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Lightbulb } from 'lucide-react';
import type { Theme } from '@/types';
import type { Idea } from './idea-box.types';
import { IdeaCard } from './idea-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';

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
  const t = useTranslations('ideaBox');
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size="lg" className="text-amber-500 dark:text-amber-500" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title={searchQuery ? t('list.emptySearch') : t('list.emptyDefault')}
        description={t('list.emptyHint')}
      />
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
