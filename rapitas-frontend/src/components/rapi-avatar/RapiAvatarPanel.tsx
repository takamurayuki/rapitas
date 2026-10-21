'use client';
/**
 * RapiAvatarPanel
 *
 * What the avatar opens: the running and interrupted executions, with the
 * actions that were on the resumable-executions banner.
 *
 * That banner used to sit in the corner permanently, saying the same thing
 * the avatar now says and taking the same space. The card is gone; its
 * contents live here, one click away, so nothing it could do was lost —
 * resuming an interrupted execution is reachable nowhere else in the app.
 *
 * Draws only. The data and the actions come from `useResumableExecutions`,
 * which the host owns so it runs once.
 */
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ExecutionItem } from '../resumable-executions/ExecutionItem';
import type { ResumableExecution } from '../resumable-executions/types';
import { taskIdFromLocation } from './intake';
import { RapiModeContent } from './RapiModeContent';
import { RAPI_BUBBLE_Z } from '@/lib/pane-layering';
import { type Routed } from './RapiPrompt';
import { RapiComposer } from './RapiComposer';
import { RapiModeTabs } from './RapiModeTabs';
import { reachableModes, visibleModes, type PanelMode } from './rapi-modes';

export { visibleModes, reachableModes, type PanelMode } from './rapi-modes';
import { BUBBLE_COLORS, SpeechBubble } from './SpeechBubble';

interface RapiAvatarPanelProps {
  executions: ResumableExecution[];
  resumingIds: Set<number>;
  dismissingIds: Set<number>;
  runningCount: number;
  interruptedCount: number;
  onResume: (id: number) => void;
  onResumeAll: () => void;
  onDismiss: (id: number) => void;
  formatTimeAgo: (dateString: string) => string;
  onClose: () => void;
  /** Lifted clear of the avatar below it. / アバターの上に出す余白 */
  bottomPx: number;
  /**
   * How far in from the panel's right edge ラピ's head is, so the tail can
   * point at it. / 尻尾をラピに向けるための右端からの距離
   */
  tailOffsetPx: number;
  /** Which surface the bubble is drawn on. / 吹き出しの配色 */
  dark: boolean;
  /**
   * Whether she is showing it.
   *
   * Closed means hidden, not gone: the panel stays mounted so that what was
   * typed, which tab was chosen and any request still in flight all survive.
   * `display: none` takes it out of the accessibility tree and out of
   * hit-testing, so hiding is as complete as unmounting from the outside —
   * it just does not throw the work away.
   */
  open: boolean;
}

/**
 * @param props - The executions to show and what can be done with them
 */
export function RapiAvatarPanel({
  executions,
  resumingIds,
  dismissingIds,
  runningCount,
  interruptedCount,
  onResume,
  onResumeAll,
  onDismiss,
  formatTimeAgo,
  onClose,
  bottomPx,
  tailOffsetPx,
  dark,
  open,
}: RapiAvatarPanelProps) {
  const t = useTranslations('banner');
  const ta = useTranslations('rapiAvatar');

  // Two explicit modes rather than guessing from the sentence. Working out
  // whether "重複しているタスク" means add one or delete several is a
  // classification that can be wrong, and being wrong about it deletes
  // things.
  // Opens on the survey rather than on the task form: the first question
  // when you reach for her is "what needs me", and answering it costs one
  // read. Filing a task is the second thing, one tab away.
  const [mode, setMode] = useState<PanelMode>('watch');

  // Which tabs exist right now. ラピ is in the app shell with no props from
  // the page, so the open task comes from the address bar — `/tasks/42` for
  // the page and `/?panel=42` for the slide panel over the list.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTask = taskIdFromLocation(pathname, searchParams?.get('panel') ?? null) !== null;
  const modes = visibleModes(hasTask);

  // Navigating off a task while reading about it would otherwise leave the
  // panel on a mode that can no longer be reached.
  //
  // `reachableModes` is called inside rather than held in a variable: a
  // fresh array each render is a new dependency each render, which would
  // re-run this on every one. What matters is whether the current mode is
  // still in it, and that only changes with `hasTask`.
  useEffect(() => {
    if (!reachableModes(hasTask).includes(mode)) setMode('watch');
  }, [hasTask, mode]);

  /**
   * The last sentence she routed, and where it went.
   *
   * Kept so the destination can be told what was said — only `create` and
   * `ask` can use a sentence; `watch`, `tidy` and `consult` are places, not
   * questions — and so the note can say where it went, which is what makes
   * a wrong turn visible rather than mysterious.
   */
  const [routed, setRouted] = useState<Routed | null>(null);
  const handleRouted = (next: Routed) => {
    setRouted(next);
    setMode(next.intent);
  };
  /** Only hand the sentence on while that destination is still showing. */
  const handedOver = (to: PanelMode) => (routed && routed.intent === to ? routed.text : undefined);

  // The consult mode hosts the task assistant that used to be a card on the
  // task detail page. It needs room the other modes do not: a conversation
  // with history in a 320px column is unreadable.
  const wide = mode === 'consult';

  // With nothing running there is no list to head, so the panel is simply
  // ラピ. Repeating the intake's own heading here would say it twice.
  const heading =
    runningCount > 0
      ? t('inProgressWork')
      : interruptedCount > 0
        ? t('interruptedWork')
        : ta('name');

  const bubble = useRef<HTMLDivElement>(null);

  /**
   * Replays the entrance on each open, without remounting anything.
   *
   * A CSS animation does not run again on an element that already carries
   * it, so keeping the panel mounted would otherwise have silently killed
   * the grow-out-of-her-tail that makes this read as ラピ speaking.
   *
   * `SpeechBubble`'s `speakKey` would replay it — by giving the bubble a new
   * element — and that is exactly the wrong tool here: a new element throws
   * away the typed text, the chosen tab and the request in flight, which is
   * the whole point of staying mounted. So the animation is restarted in
   * place: clear it, force a reflow to make the clear take effect, put it
   * back. The reflow read is load-bearing, not a leftover.
   */
  useEffect(() => {
    if (!open) return;
    const el = bubble.current;
    if (!el) return;
    const original = el.style.animation;
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = original;
  }, [open]);

  useEffect(() => {
    // Nothing to dismiss while it is hidden, and the outside-click listener
    // would otherwise call onClose on every click anywhere in the app.
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Looking away should end it. Hunting for an X is the wrong shape for
    // something that reads as speech, and Escape is keyboard-only.
    const onOutside = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target || bubble.current?.contains(target)) return;
      // ラピ herself is excluded, or her own toggle would fight this: closed
      // here on pointerdown, reopened by the click that follows.
      if (target instanceof Element && target.closest('[data-rapi-avatar="true"]')) return;
      onClose();
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [onClose, open]);

  return (
    <SpeechBubble
      innerRef={bubble}
      role="dialog"
      aria-label={heading}
      tailSide="bottom"
      tailOffsetPx={tailOffsetPx}
      {...BUBBLE_COLORS[dark ? 'dark' : 'light']}
      style={{
        position: 'fixed',
        right: 24,
        bottom: bottomPx,
        zIndex: RAPI_BUBBLE_Z,
        pointerEvents: 'auto',
        // Hidden rather than removed: out of the accessibility tree and out
        // of hit-testing, while the state and any request in flight stay.
        ...(open ? {} : { display: 'none' }),
      }}
      // No radius or border class: the bubble owns both, and its radius is
      // asymmetric where the tail leaves. `shadow-lg` not `shadow-xl` —
      // overlays get one elevation level (docs/design/ui-design-language.md).
      className={`flex max-h-[70vh] flex-col shadow-lg ${wide ? 'w-[34rem]' : 'w-80'}`}
    >
      {/* No name here any more. A bar reading 「ラピ」 above her own speech
          bubble said nothing the bubble did not: she is the thing you just
          clicked. The greeting below says what she is FOR, once. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <span className="flex-1 text-[11px] text-zinc-400">
          {runningCount > 0 && t('runningCount', { count: runningCount })}
          {runningCount > 0 && interruptedCount > 0 && ' / '}
          {interruptedCount > 0 && t('resumableCount', { count: interruptedCount })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeAll')}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <RapiModeTabs modes={modes} mode={mode} onSelect={setMode} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Said once, before anything has been asked for. It is the only
            thing on screen that explains what this panel is; after the first
            sentence it would just be taking room from the answer. */}
        {!routed && (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            {ta('greeting')}
          </p>
        )}

        <RapiModeContent mode={mode} handedOver={handedOver} />
        <div className="space-y-2 p-2">
          {executions.map((exec) => (
            <ExecutionItem
              key={exec.id}
              exec={exec}
              isResuming={resumingIds.has(exec.id)}
              isDismissing={dismissingIds.has(exec.id)}
              onResume={onResume}
              onDismiss={onDismiss}
              formatTimeAgo={formatTimeAgo}
            />
          ))}
        </div>
      </div>

      <RapiComposer routed={routed} mode={mode} hasOpenTask={hasTask} onRouted={handleRouted} />

      {/* Only offered when there is something to resume — everything
          running is already on its way. */}
      {interruptedCount > 0 && (
        <div className="shrink-0 border-t border-zinc-200 p-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={onResumeAll}
            className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            {t('resumeAll')}
          </button>
        </div>
      )}
    </SpeechBubble>
  );
}
