'use client';
// NoteEditorFooter
import { useTranslations } from 'next-intl';
import { Calendar } from 'lucide-react';

interface NoteEditorFooterProps {
  createdAt: string | Date;
  updatedAt: string | Date;
  dateLocale: string;
}

/**
 * Footer bar showing note creation and update dates.
 *
 * @param props - createdAt, updatedAt timestamps and the locale string for formatting.
 */
export default function NoteEditorFooter({
  createdAt,
  updatedAt,
  dateLocale,
}: NoteEditorFooterProps) {
  const t = useTranslations('notes');
  return (
    <div className="flex items-center justify-between p-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-500 dark:text-zinc-400">
      <div className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        <span>
          {t('editorFooter.createdAt', {
            date: new Date(createdAt).toLocaleDateString(dateLocale),
          })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Calendar className="w-3 h-3" />
        <span>
          {t('editorFooter.updatedAt', {
            date: new Date(updatedAt).toLocaleDateString(dateLocale),
          })}
        </span>
      </div>
    </div>
  );
}
