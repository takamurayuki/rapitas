'use client';
/**
 * RapiPrompt
 *
 * The box you write to ラピ in, pinned under the conversation.
 *
 * Only the box: what happens to a sentence once it is sent — routing it,
 * or answering it in words — is `useRapiConversation`'s. The box is
 * controlled from there so a sentence that could not be sent can be handed
 * back to it.
 */
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { isImeComposing } from '@/utils/ime';

/**
 * How tall the box may grow, in pixels.
 *
 * About eight lines at 14px. Past that the panel is a text editor and the
 * conversation above it has nowhere left to go, so it scrolls instead.
 */
const MAX_INPUT_PX = 200;

/**
 * How tall the box is before anything is typed.
 *
 * Three lines, not one. A single line at 12px read as a search field and
 * was reported as too cramped to write a request in (2026-11-14).
 */
export const MIN_INPUT_PX = 72;

/** Where a sentence can be sent. Mirrors the server's routable intents. */
export type PromptDestination =
  | 'watch'
  | 'create'
  | 'ask'
  | 'tidy'
  | 'consult'
  | 'roadmap'
  | 'change';

export interface RapiPromptProps {
  text: string;
  onChange: (text: string) => void;
  /** Whether a sentence is on its way. / 送信中か */
  sending: boolean;
  onSend: () => void;
  onCancel: () => void;
}

/**
 * @param props - The box's text, and what to do on send and cancel
 */
export function RapiPrompt({ text, onChange, sending, onSend, onCancel }: RapiPromptProps) {
  const t = useTranslations('rapiAvatar.prompt');

  /**
   * Grow with the content.
   *
   * Reset to `auto` first: `scrollHeight` reports the content's height only
   * when the element is not already being held taller than it, so measuring
   * without this makes the box grow and never shrink back.
   */
  const box = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, MIN_INPUT_PX), MAX_INPUT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_INPUT_PX ? 'auto' : 'hidden';
  }, [text]);

  return (
    <div className="shrink-0 space-y-1 border-t border-zinc-200 px-3 pt-2 pb-2 dark:border-zinc-700">
      <div className="relative">
        <textarea
          ref={box}
          rows={3}
          value={text}
          placeholder={t('placeholder')}
          aria-label={t('label')}
          // Locked while a sentence is on its way: what comes back answers
          // what was sent, so a box that still accepts typing says otherwise.
          disabled={sending}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. Guarded against IME:
            // the Enter that commits a Japanese conversion must not also send.
            if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
              e.preventDefault();
              onSend();
            }
          }}
          style={{ minHeight: MIN_INPUT_PX }}
          className="block w-full resize-none rounded-lg border border-zinc-200 bg-white py-2 pr-11 pl-3 text-sm leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-indigo-500"
        />
        {/* Enter already sends; the button is for whoever does not know that,
            and for a pointer that is already in the panel. */}
        <button
          type="button"
          onClick={onSend}
          disabled={sending || !text.trim()}
          aria-label={t('send')}
          title={t('send')}
          className="absolute right-2 bottom-2 rounded-md bg-indigo-600 p-1.5 text-white transition-colors hover:bg-indigo-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {sending ? (
        // The thread already shows her thinking; here is only the way out.
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 text-[11px] text-zinc-500 hover:underline dark:text-zinc-400"
          >
            {t('cancel')}
          </button>
        </div>
      ) : (
        <p className="text-[10px] text-zinc-400">{t('hint')}</p>
      )}
    </div>
  );
}
