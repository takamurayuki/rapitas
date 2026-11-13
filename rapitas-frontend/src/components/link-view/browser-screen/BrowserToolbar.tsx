'use client';
/**
 * BrowserToolbar
 *
 * The /browser screen's toolbar: page back / forward / reload, the address
 * bar, save to favourites, the favourites list, open externally, and "…".
 *
 * Page back/forward (desktop only — a cross-origin iframe's history cannot be
 * driven) are labelled "ページを戻る/進む" to keep them apart from the
 * header's back/forward, which move between app screens. They are always
 * enabled: no API says whether the page can go back, and asking the page
 * would mean running script in it (nav60 §1.3, §5.1).
 *
 * "Open externally" never moves into "…" at any width — on the web it is
 * the rescue for a page that will not display.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkPlus,
  Cookie,
  ExternalLink,
  Info,
  RotateCw,
} from 'lucide-react';
import DropdownMenu, { type DropdownMenuItem } from '@/components/ui/dropdown/DropdownMenu';
import { isImeComposing } from '@/utils/ime';

interface BrowserToolbarProps {
  isDesktop: boolean;
  /** The active tab's URL, or '' on the start page. / 表示中の URL */
  url: string;
  hasPage: boolean;
  saved: boolean;
  loading: boolean;
  /** Focus the address bar (start page with no tab). / アドレス欄にフォーカス */
  autoFocusAddress: boolean;
  onHistory: (action: 'back' | 'forward') => void;
  onReload: () => void;
  /** What was typed; the screen resolves it (URL or search). / 入力内容 */
  onSubmit: (typed: string) => void;
  onSave: () => void;
  onShowFavourites: () => void;
  onOpenExternal: () => void;
  onClearData: () => void;
}

const iconButton =
  'shrink-0 rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100';

/**
 * @param props - Current page state and the toolbar actions / 状態と操作
 */
export function BrowserToolbar(props: BrowserToolbarProps) {
  const t = useTranslations('browser');
  const tl = useTranslations('linkView');
  const { isDesktop, url, hasPage, saved } = props;
  const [draft, setDraft] = useState(url);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Resynced when the tab or its URL changes underneath (a tab switch, a
  // link followed inside the page) so the field never shows a stale page.
  useEffect(() => {
    setDraft(url);
  }, [url]);

  // The start page exists to go somewhere: focus the address bar (Q6).
  useEffect(() => {
    if (props.autoFocusAddress) inputRef.current?.focus();
  }, [props.autoFocusAddress]);

  const submit = () => {
    if (!draft.trim() || draft === url) return;
    props.onSubmit(draft);
  };

  const moreItems: DropdownMenuItem[] = [
    ...(hasPage
      ? [
          {
            label: saved ? tl('alreadySaved') : tl('saveToFavourites'),
            icon: <BookmarkPlus className="h-4 w-4" />,
            onClick: props.onSave,
            disabled: saved,
          },
        ]
      : []),
    {
      label: tl('favourites'),
      icon: <Bookmark className="h-4 w-4" />,
      onClick: props.onShowFavourites,
    },
    isDesktop
      ? {
          label: t('clearData'),
          icon: <Cookie className="h-4 w-4" />,
          onClick: props.onClearData,
          variant: 'danger' as const,
        }
      : {
          label: t('webClearDataHint'),
          icon: <Info className="h-4 w-4" />,
          onClick: () => {},
          disabled: true,
        },
  ];

  return (
    <div className="relative flex shrink-0 items-center gap-0.5 border-b border-zinc-200 px-2 py-1 dark:border-zinc-700">
      {isDesktop && (
        <>
          <button
            type="button"
            onClick={() => props.onHistory('back')}
            disabled={!hasPage}
            title={tl('back')}
            aria-label={tl('back')}
            className={iconButton}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => props.onHistory('forward')}
            disabled={!hasPage}
            title={tl('forward')}
            aria-label={tl('forward')}
            className={iconButton}
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={props.onReload}
        disabled={!hasPage}
        title={tl('reload')}
        aria-label={tl('reload')}
        className={iconButton}
      >
        <RotateCw className="h-4 w-4" />
      </button>

      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isImeComposing(e)) submit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(url);
          }
        }}
        onBlur={() => {
          // Leaving the field confirms an edit of an open page, as the pane
          // does; on the start page it only keeps what was typed.
          if (hasPage) submit();
        }}
        spellCheck={false}
        aria-label={tl('addressLabel')}
        placeholder={t('addressPlaceholder')}
        title={url || undefined}
        className="mx-1 min-w-0 flex-1 truncate rounded border border-transparent bg-zinc-100 px-2.5 py-1 text-sm text-zinc-700 outline-none focus:border-indigo-400 focus:bg-white dark:bg-zinc-800 dark:text-zinc-200 dark:focus:bg-zinc-900"
      />

      {hasPage && (
        <button
          type="button"
          onClick={props.onSave}
          title={saved ? tl('alreadySaved') : tl('saveToFavourites')}
          aria-label={saved ? tl('alreadySaved') : tl('saveToFavourites')}
          className={`hidden sm:inline-flex ${iconButton}`}
        >
          {saved ? (
            <Bookmark className="h-4 w-4 fill-current text-indigo-500" />
          ) : (
            <BookmarkPlus className="h-4 w-4" />
          )}
        </button>
      )}
      <button
        type="button"
        onClick={props.onShowFavourites}
        title={tl('favourites')}
        aria-label={tl('favourites')}
        className={`hidden sm:inline-flex ${iconButton}`}
      >
        <Bookmark className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={props.onOpenExternal}
        disabled={!hasPage}
        title={tl('openExternally')}
        aria-label={tl('openExternally')}
        data-testid="browser-open-external"
        className={iconButton}
      >
        <ExternalLink className="h-4 w-4" />
      </button>
      <DropdownMenu
        items={moreItems}
        variant="ghost"
        triggerLabel={t('more')}
        menuLabel={t('more')}
        triggerClassName="shrink-0"
      />

      {props.loading && (
        <div
          role="progressbar"
          aria-label={t('loading')}
          data-testid="browser-progress"
          className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden bg-indigo-100 dark:bg-indigo-500/20"
        >
          <div className="h-full w-1/3 animate-pulse bg-indigo-500" />
        </div>
      )}
    </div>
  );
}
