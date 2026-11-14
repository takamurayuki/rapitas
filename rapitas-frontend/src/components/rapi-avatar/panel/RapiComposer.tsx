'use client';
/**
 * RapiComposer
 *
 * The box you type into, pinned to the bottom of the panel.
 *
 * It used to sit above the content, where a fixed single line shrank
 * against the list below it and read as a search field — measured at 30px
 * in the live 320px bubble. A composer belongs at the bottom, out of the
 * scroll area, so it stays put while the answer scrolls past it.
 *
 * Where the last sentence went is shown here rather than up with the
 * content, because a misroute is about what was just typed and not about
 * what happens to be on screen now.
 */
import { useTranslations } from 'next-intl';
import { RapiPrompt, type Routed } from './RapiPrompt';
import type { PanelMode } from './rapi-modes';

interface Props {
  /** Where the last sentence was routed, if anywhere. / 直近の振り分け結果 */
  routed: Routed | null;
  mode: PanelMode;
  hasOpenTask: boolean;
  onRouted: (routed: Routed) => void;
  /** A sentence to put in the box. / 入力欄に入れる文 */
  seed?: { text: string; n: number };
}

/**
 * @param props - The last routing, where we are, and how to route the next one
 */
export function RapiComposer({ routed, mode, hasOpenTask, onRouted, seed }: Props) {
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');

  return (
    <div className="shrink-0 border-t border-zinc-200 dark:border-zinc-700">
      {routed && routed.intent === mode && (
        <div className="flex items-baseline gap-2 px-3 pt-1.5">
          <p className="min-w-0 flex-1 text-[11px] text-zinc-400">
            {ta('prompt.tookItAs', { where: tm(routed.intent), reason: routed.reason })}
          </p>
          {/*
            The one correction worth offering. Routing is a model call and
            will sometimes be wrong; every other destination is a rewording
            away, and the roadmap is the one a misroute most often misses.
            Measured at 14/15, and the miss was exactly this —
            "英語を毎日続けられるようにしたい" read as a single task.
          */}
          {mode !== 'roadmap' && (
            <button
              type="button"
              onClick={() => onRouted({ ...routed, intent: 'roadmap' })}
              className="shrink-0 text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {ta('prompt.ratherPlan')}
            </button>
          )}
        </div>
      )}
      <RapiPrompt hasOpenTask={hasOpenTask} onRouted={onRouted} seed={seed} />
    </div>
  );
}
