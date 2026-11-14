'use client';
/**
 * RapiModeHeader
 *
 * Says where a sentence took you, and is the way back to the conversation.
 *
 * Replaces the tab bar. Every mode is reached by writing what you want, so a
 * row of buttons was a second way of doing the same thing — and one that
 * had to grow a glyph for every capability. What still has to be on screen
 * is where you are and how to return; that is all this draws.
 *
 * Nothing on the conversation itself: it is where you already are.
 */
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MODE_ICONS, type PanelMode } from './rapi-modes';

interface Props {
  /** Where we are now. / 現在のモード */
  mode: PanelMode;
  /** Back to the conversation. / 対話に戻る */
  onBack: () => void;
}

/**
 * @param props - The current mode and how to leave it
 */
export function RapiModeHeader({ mode, onBack }: Props) {
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');
  if (mode === 'chat') return null;
  const Icon = MODE_ICONS[mode];

  return (
    <div
      data-rapi-mode-header={mode}
      className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={ta('backToChat')}
        title={ta('backToChat')}
        className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{tm(mode)}</span>
    </div>
  );
}
