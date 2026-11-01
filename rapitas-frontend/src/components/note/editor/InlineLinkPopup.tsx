'use client';
/**
 * InlineLinkPopup
 *
 * The small panel over a link in note text: where it goes, and the three
 * things to do with it — open, re-point, remove.
 *
 * Fixed-positioned because the editor scrolls and the anchor's rectangle is
 * measured in viewport coordinates.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink, Pencil, Unlink } from 'lucide-react';
import type { InlineLinkPopupState } from './useInlineLinks';

interface InlineLinkPopupProps {
  state: InlineLinkPopupState;
  onOpen: () => void;
  onRemove: () => void;
  onRetarget: (url: string) => void;
  onDismiss: () => void;
  /** Keep it up while the pointer is on it. / ポップアップ上では維持 */
  onHold: () => void;
  onRelease: () => void;
}

/** Height of the panel, used to place it above the link. */
const POPUP_OFFSET_PX = 8;

const action =
  'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-50';

/**
 * @param props - The link being pointed at and what to do with it
 */
export function InlineLinkPopup({
  state,
  onOpen,
  onRemove,
  onRetarget,
  onDismiss,
  onHold,
  onRelease,
}: InlineLinkPopupProps) {
  const t = useTranslations('notes');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.url);

  // A different link under the pointer is a different panel; drop any edit
  // in progress rather than carrying it across.
  useEffect(() => {
    setEditing(false);
    setDraft(state.url);
  }, [state.url]);

  return (
    <div
      role="toolbar"
      aria-label={t('linkPanelLabel')}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      style={{ left: state.x, top: Math.max(state.y - POPUP_OFFSET_PX, 0) }}
      className="fixed z-50 -translate-y-full rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRetarget(draft);
              // Esc closes the note modal at the window level; here it
              // should only abandon the edit.
              if (e.key === 'Escape') {
                e.stopPropagation();
                setEditing(false);
                setDraft(state.url);
              }
            }}
            aria-label={t('linkUrlLabel')}
            spellCheck={false}
            className="w-64 min-w-0 rounded bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-200"
          />
          <button type="button" onClick={() => onRetarget(draft)} className={action}>
            {t('linkApply')}
          </button>
        </div>
      ) : (
        <div className="flex max-w-xs items-center gap-1">
          <span
            title={state.url}
            className="min-w-0 flex-1 truncate px-1 text-[11px] text-zinc-400"
          >
            {state.url}
          </span>
          <button type="button" onClick={onOpen} className={action}>
            <ExternalLink className="h-3 w-3" />
            {t('linkOpen')}
          </button>
          <button type="button" onClick={() => setEditing(true)} className={action}>
            <Pencil className="h-3 w-3" />
            {t('linkEdit')}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className={`${action} hover:text-rose-600 dark:hover:text-rose-400`}
          >
            <Unlink className="h-3 w-3" />
            {t('linkRemove')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('linkDismiss')}
            className="sr-only"
          >
            {t('linkDismiss')}
          </button>
        </div>
      )}
    </div>
  );
}
