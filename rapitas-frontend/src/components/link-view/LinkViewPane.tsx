'use client';
/**
 * LinkViewPane
 *
 * The in-app reading pane for a link from a note or a task description. The
 * page itself is a Tauri child webview laid over the placeholder below — this
 * component owns only the chrome and the box the webview is told to fill.
 *
 * NOTE: the placeholder stays empty on purpose. Anything rendered inside it
 * would be hidden by the webview's own surface, which an OS-level view always
 * paints above regardless of z-index.
 */
import { useTranslations } from 'next-intl';
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, X } from 'lucide-react';
import { openExternalUrl } from '@/utils/tauri';

interface LinkViewPaneProps {
  /** The URL on show, used for the address label. / 表示中のURL */
  url: string;
  /** The element the webview is sized to. / webview の矩形基準 */
  placeholderRef: React.RefObject<HTMLDivElement | null>;
  /** Close the pane. / 閉じる */
  onClose: () => void;
  /** Move history or reload. / 履歴操作 */
  onHistory: (action: 'back' | 'forward' | 'reload') => void;
}

/** The host of a URL, or the whole string when it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * @param props - The docked URL, its placeholder and the pane's controls
 */
export function LinkViewPane({ url, placeholderRef, onClose, onHistory }: LinkViewPaneProps) {
  const t = useTranslations('linkView');

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-zinc-200 dark:border-zinc-700">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
        <button
          onClick={() => onHistory('back')}
          title={t('back')}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onHistory('forward')}
          title={t('forward')}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onHistory('reload')}
          title={t('reload')}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>

        <span
          className="mx-1 min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400"
          title={url}
        >
          {hostOf(url)}
        </span>

        <button
          onClick={() => void openExternalUrl(url)}
          title={t('openExternally')}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onClose}
          title={t('close')}
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The webview covers this box; leaving it empty avoids drawing content
          nobody can see. The background shows for the frame before it docks. */}
      <div ref={placeholderRef} className="min-h-0 flex-1 bg-zinc-50 dark:bg-zinc-900" />
    </div>
  );
}
