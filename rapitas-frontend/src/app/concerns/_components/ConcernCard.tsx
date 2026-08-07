'use client';

/**
 * ConcernCard
 *
 * Renders one concern row: type/severity/status/theme badges, the GitHub-issue
 * link badge, and the action buttons (convert / publish / dismiss / delete).
 * Publishing is one click — the server resolves the target repo from the
 * concern's theme, so there is no repo picker.
 */

import { useTranslations } from 'next-intl';
import {
  ListPlus,
  Trash2,
  Loader2,
  Upload,
  CircleDot,
  ExternalLink,
  FolderOpen,
} from 'lucide-react';
import { getIconComponent } from '@/components/category/icon-data';
import PriorityIcon from '@/feature/tasks/components/priority/PriorityIcon';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import {
  TYPE_META,
  TYPE_LABEL_KEY,
  SEVERITY_HINT_KEY,
  SOURCE_LABEL_KEY,
  type Concern,
} from './concern-shared';

interface ConcernCardProps {
  concern: Concern;
  busy: boolean;
  /** Whether at least one GitHub integration exists (gates the publish button). */
  canPublish: boolean;
  /** The concern's theme, for the theme-name badge (null = unknown). */
  theme?: { name: string; icon?: string | null; color?: string | null } | null;
  onConvert: (id: number) => void;
  onDelete: (id: number) => void;
  /**
   * Publish the concern as a GitHub issue in one click. The server resolves the
   * target repo from the concern's theme.
   */
  onPublish: (id: number) => Promise<void>;
}

/** A single concern card with bridge-aware actions and badges. */
export function ConcernCard({
  concern: c,
  busy,
  canPublish,
  theme,
  onConvert,
  onDelete,
  onPublish,
}: ConcernCardProps) {
  const t = useTranslations('concerns');
  const tCommon = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const TyIcon = TYPE_META[c.type].icon;
  const ThemeIcon = getIconComponent(theme?.icon || '') || FolderOpen;
  // Unknown source values fall back to the raw string — next-intl's t() throws on
  // missing keys, so it must not be called with an unmapped source.
  const sourceLabel = SOURCE_LABEL_KEY[c.source] ? t(SOURCE_LABEL_KEY[c.source]) : c.source;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_META[c.type].badge}`}
            >
              <TyIcon className="h-2.5 w-2.5" />
              {t(TYPE_LABEL_KEY[c.type])}
            </span>
            {/* Source badge — text-only (no glyph; see ICON_POLICY: avoid minting
                10+ new icon meanings for an open-ended source vocabulary). */}
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {sourceLabel}
            </span>
            {/* Theme, then priority icon to its right (matches the idea box). */}
            <span className="flex items-center gap-1">
              {theme && (
                <span
                  className="flex items-center gap-0.5 text-[10px] font-medium"
                  style={{ color: theme.color || '#059669' }}
                  title={t('card.themeTitle', { name: theme.name })}
                >
                  <ThemeIcon className="h-2.5 w-2.5" />
                  {theme.name}
                </span>
              )}
              <span title={t('card.priorityTitle', { hint: t(SEVERITY_HINT_KEY[c.severity]) })}>
                <PriorityIcon priority={c.severity} size="sm" />
              </span>
            </span>
            {c.status === 'task_created' && c.createdTaskId && (
              <a
                href={`/tasks/${c.createdTaskId}`}
                className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600 hover:underline dark:bg-green-900/30 dark:text-green-300"
              >
                {t('card.taskCreatedBadge', { id: c.createdTaskId })}
              </a>
            )}
            {/* GitHub publish link badge */}
            {c.linkedIssue && (
              <a
                href={c.linkedIssue.url}
                target="_blank"
                rel="noopener noreferrer"
                title={t('card.githubIssueTitle')}
                className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium hover:underline ${
                  c.linkedIssue.state === 'closed'
                    ? 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                <CircleDot className="h-2.5 w-2.5" />#{c.linkedIssue.issueNumber}
                {c.linkedIssue.state === 'closed' ? t('card.closedSuffix') : ''}
                <ExternalLink className="h-2 w-2" />
              </a>
            )}
            <span className="ml-auto text-[10px] text-zinc-500">
              {new Date(c.createdAt).toLocaleDateString(toDateLocale(locale))}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">{c.title}</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
            {c.detail}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
            {c.location && (
              <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
                {c.location}
              </code>
            )}
            {c.originTaskId && (
              <a href={`/tasks/${c.originTaskId}`} className="hover:underline">
                {t('card.originLink', { id: c.originTaskId })}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
        {c.status === 'open' && (
          <button
            onClick={() => onConvert(c.id)}
            disabled={busy}
            className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListPlus className="h-3 w-3" />}
            {t('card.convertButton')}
          </button>
        )}
        {/* Publish to GitHub — one click; the server resolves the repo from the
            concern's theme. Only for open, not-yet-published concerns. */}
        {c.status === 'open' && !c.linkedIssue && canPublish && (
          <button
            onClick={() => onPublish(c.id)}
            disabled={busy}
            title={t('card.publishTitle')}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {t('card.publishButton')}
          </button>
        )}
        <button
          onClick={() => onDelete(c.id)}
          disabled={busy}
          title={tCommon('delete')}
          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-zinc-800"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
