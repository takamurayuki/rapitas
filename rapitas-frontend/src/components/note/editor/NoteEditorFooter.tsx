'use client';
// NoteEditorFooter
import { useTranslations } from 'next-intl';
import { Calendar } from 'lucide-react';
import { formatDate } from '@/utils/date';

interface NoteEditorFooterProps {
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * Footer bar showing note creation and update dates.
 *
 * @param props - createdAt, updatedAt timestamps.
 */
export default function NoteEditorFooter({ createdAt, updatedAt }: NoteEditorFooterProps) {
  const t = useTranslations('notes');
  return (
    <div className="flex items-center justify-between p-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        <span>
          {t('editorFooter.createdAt', {
            date: formatDate(createdAt),
          })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        <span>
          {t('editorFooter.updatedAt', {
            date: formatDate(updatedAt),
          })}
        </span>
      </div>
    </div>
  );
}
