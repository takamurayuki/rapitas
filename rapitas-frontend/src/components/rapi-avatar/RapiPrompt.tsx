'use client';
/**
 * RapiPrompt
 *
 * The one place to type at ラピ, and the note saying where she took it.
 *
 * The tab bar was the only way in, and it cannot stay short: four of her five
 * modes are useful from anywhere, so hiding by page does not slow the growth,
 * and merging only worked while two of them happened to be one job. Measured
 * after that merge, the four tabs fill 290 of the bubble's 320px — one more
 * and the row wraps. A front door does not grow: a new capability becomes
 * another destination, not another tab.
 *
 * The tabs stay, as shortcuts and as the honest fallback. When she cannot
 * tell what was meant she says so and leaves them to it, because a shrug
 * costs a click and a confident wrong turn costs the belief that she
 * understood.
 *
 * Routing itself is safe to hand a model because no destination writes
 * anything — the two that eventually can ask for their own confirmation
 * after you arrive. So the worst a wrong turn does is show you the wrong
 * read, which the note below makes visible.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { isImeComposing } from '@/utils/ime';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rapi-prompt');

/** Where a sentence can be sent. Mirrors the server's routable intents. */
export type PromptDestination = 'watch' | 'create' | 'ask' | 'tidy' | 'consult' | 'roadmap';

/** What a routed sentence turned into. */
export interface Routed {
  intent: PromptDestination;
  reason: string;
  /** The sentence itself, for the destinations that can use it. */
  text: string;
}

export interface RapiPromptProps {
  /** True when `consult` is a destination that exists right now. */
  hasOpenTask: boolean;
  /** Called when she has decided where this goes. */
  onRouted: (routed: Routed) => void;
}

export function RapiPrompt({ hasOpenTask, onRouted }: RapiPromptProps) {
  const t = useTranslations('rapiAvatar.prompt');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  /** The last thing she could not place, shown until the next attempt. */
  const [unplaced, setUnplaced] = useState<string | null>(null);

  const send = async () => {
    const said = text.trim();
    if (!said || sending) return;
    setSending(true);
    setUnplaced(null);
    try {
      const res = await fetch(`${API_BASE_URL}/assistant/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: said, hasOpenTask }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        routed?: boolean;
        intent?: PromptDestination;
        reason?: string;
      };
      if (!data.routed || !data.intent) {
        // Not an error — she looked and could not tell. The tabs are right
        // there, so saying so is a complete answer.
        setUnplaced(said);
        return;
      }
      setText('');
      onRouted({ intent: data.intent, reason: data.reason ?? '', text: said });
    } catch (err) {
      logger.warn({ err }, 'could not route');
      setUnplaced(said);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-1 px-2 pt-2">
      <textarea
        rows={1}
        value={text}
        placeholder={t('placeholder')}
        aria-label={t('label')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. Guarded against IME:
          // the Enter that commits a Japanese conversion must not also send.
          if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
            e.preventDefault();
            void send();
          }
        }}
        className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {sending && <p className="text-[10px] text-zinc-400">{t('thinking')}</p>}
      {unplaced && !sending && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">{t('unplaced')}</p>
      )}
    </div>
  );
}
