/**
 * ConcernList
 *
 * Renders the concern list area: loading spinner, empty state, or the list of
 * ConcernCard rows. Pagination and filters are rendered by the orchestrator.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Bug } from 'lucide-react';
import type { Theme } from '@/types';
import { ConcernCard } from './ConcernCard';
import type { Concern } from './concern-shared';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';

interface ConcernListProps {
  isLoading: boolean;
  concerns: Concern[];
  /** The id of the concern with an in-flight action (disables its buttons). */
  busyId: number | null;
  /** Whether at least one GitHub integration exists (gates the publish button). */
  canPublish: boolean;
  /** Theme lookup for the per-card theme-name badge. */
  themeById: Map<number, Theme>;
  onConvert: (id: number) => void;
  onDelete: (id: number) => void;
  onPublish: (id: number) => Promise<void>;
}

/**
 * Render the concern list (loading / empty / populated).
 *
 * @param props - List data and row action handlers from useConcerns. / 一覧データと行アクションハンドラ。
 */
export function ConcernList({
  isLoading,
  concerns,
  busyId,
  canPublish,
  themeById,
  onConvert,
  onDelete,
  onPublish,
}: ConcernListProps) {
  const t = useTranslations('concerns');
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (concerns.length === 0) {
    return <EmptyState icon={Bug} title={t('emptyState')} />;
  }

  return (
    <div className="space-y-2">
      {concerns.map((c) => (
        <ConcernCard
          key={c.id}
          concern={c}
          busy={busyId === c.id}
          canPublish={canPublish}
          theme={c.themeId != null ? (themeById.get(c.themeId) ?? null) : null}
          onConvert={onConvert}
          onDelete={onDelete}
          onPublish={onPublish}
        />
      ))}
    </div>
  );
}
