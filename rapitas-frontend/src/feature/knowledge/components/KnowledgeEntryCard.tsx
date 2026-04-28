'use client';

import { useTranslations } from 'next-intl';
import type { KnowledgeEntry } from '../types';

interface KnowledgeEntryCardProps {
  entry: KnowledgeEntry;
  similarity?: number;
  onClick?: () => void;
  onArchive?: (id: number) => void;
}

const stageColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  dormant: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  archived: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

const validationColors: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  validated: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  conflict: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

export function KnowledgeEntryCard({
  entry,
  similarity,
  onClick,
  onArchive,
}: KnowledgeEntryCardProps) {
  const t = useTranslations('knowledge');

  const confidencePercent = Math.round(entry.confidence * 100);
  const decayPercent = Math.round(entry.decayScore * 100);

  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 line-clamp-1">
          {entry.title}
        </h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${stageColors[entry.forgettingStage] ?? ''}`}
          >
            {t(`stages.${entry.forgettingStage}`)}
          </span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${validationColors[entry.validationStatus] ?? ''}`}
          >
            {t(`validationStatuses.${entry.validationStatus}`)}
          </span>
        </div>
      </div>

      <p className="mt-1.5 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
        {entry.content}
      </p>

      <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <span className="font-medium">{t('category')}:</span>
          {t(`categories.${entry.category}`)}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-medium">{t('confidence')}:</span>
          {confidencePercent}%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-medium">{t('decayScore')}:</span>
          {decayPercent}%
        </span>
        {similarity !== undefined && (
          <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400">
            <span className="font-medium">{t('similarity')}:</span>
            {Math.round(similarity * 100)}%
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {t(`sourceTypes.${entry.sourceType}`)}
        </span>
        {entry.tags.length > 0 && (
          <div className="flex gap-1">
            {entry.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {tag}
              </span>
            ))}
            {entry.tags.length > 3 && (
              <span className="text-xs text-gray-400">+{entry.tags.length - 3}</span>
            )}
          </div>
        )}
        {entry.pinnedUntil && new Date(entry.pinnedUntil) > new Date() && (
          <span className="text-xs text-amber-600 dark:text-amber-400">Pinned</span>
        )}
      </div>
    </div>
  );
}
