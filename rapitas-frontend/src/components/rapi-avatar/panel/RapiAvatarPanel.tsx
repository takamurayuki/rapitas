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
import { usePanelPresence } from './usePanelPresence';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ExecutionItem } from '../../resumable-executions/ExecutionItem';
import type { ResumableExecution } from '../../resumable-executions/types';
import { taskIdFromLocation } from '../intake';
import { RapiModeContent } from './RapiModeContent';
import { RAPI_BUBBLE_Z } from '@/lib/pane-layering';
import type { PanelPlacement } from '../avatar/drag';
import { type Routed } from './RapiPrompt';
import { RapiComposer } from './RapiComposer';
import { RapiExamples } from './RapiExamples';
import { RapiModeHeader } from './RapiModeHeader';
import { RapiHistory, type AskedFor } from './RapiHistory';
import { DEFAULT_MODE, MAX_HISTORY, reachableModes, type PanelMode } from './rapi-modes';

export { visibleModes, reachableModes, type PanelMode } from './rapi-modes';
import { BUBBLE_COLORS, SpeechBubble } from '../avatar/SpeechBubble';

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
  /**
   * Where to draw it relative to ラピ, wherever she has been carried, and
   * where its tail points. From `placePanel`. / ラピの位置から決めた配置
   */
  placement: PanelPlacement;
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
  placement,
  dark,
  open,
}: RapiAvatarPanelProps) {
  const t = useTranslations('banner');
  const ta = useTranslations('rapiAvatar');

  // Opens on the conversation. Every other mode is reached by writing what
  // you want there — the tab bar that also led to them is gone (2026-11-14):
  // two ways of doing one thing, one of which grew a button per capability.
  const [mode, setMode] = useState<PanelMode>(DEFAULT_MODE);

  // Whether `consult` exists right now. ラピ is in the app shell with no
  // props from the page, so the open task comes from the address bar —
  // `/tasks/42` for the page and `/?panel=42` for the slide panel.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTask = taskIdFromLocation(pathname, searchParams?.get('panel') ?? null) !== null;

  /** An example sentence to put in the box. */
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>(undefined);
  const pickExample = (text: string) => setSeed((prev) => ({ text, n: (prev?.n ?? 0) + 1 }));

  // Navigating off a task while reading about it would otherwise leave the
  // panel on a mode that can no longer be reached.
  //
  // `reachableModes` is called inside rather than held in a variable: a
  // fresh array each render is a new dependency each render, which would
  // re-run this on every one. What matters is whether the current mode is
  // still in it, and that only changes with `hasTask`.
  useEffect(() => {
    if (!reachableModes(hasTask).includes(mode)) setMode(DEFAULT_MODE);
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
  /**
   * What has been asked this session, newest first.
   *
   * Capped: this is a way back to something, not a transcript, and the row
   * it draws is one line in a 320px panel.
   */
  const [history, setHistory] = useState<AskedFor[]>([]);
  const handleRouted = (next: Routed) => {
    setRouted(next);
    setMode(next.intent);
    setHistory((prev) => [{ text: next.text, intent: next.intent }, ...prev].slice(0, MAX_HISTORY));
  };
  /** Only hand the sentence on while that destination is still showing. */
  const handedOver = (to: PanelMode) => (routed && routed.intent === to ? routed.text : undefined);

  // With nothing running there is no list to head, so the panel is simply
  // ラピ. Repeating the intake's own heading here would say it twice.
  const heading =
    runningCount > 0
      ? t('inProgressWork')
      : interruptedCount > 0
        ? t('interruptedWork')
        : ta('name');

  const bubble = useRef<HTMLDivElement>(null);
  usePanelPresence(bubble, open, onClose);

  return (
    <SpeechBubble
      innerRef={bubble}
      role="dialog"
      aria-label={heading}
      tailSide={placement.side === 'above' ? 'bottom' : 'top'}
      tailOffsetPx={placement.tailOffsetPx}
      {...BUBBLE_COLORS[dark ? 'dark' : 'light']}
      style={{
        position: 'fixed',
        right: placement.right,
        ...(placement.side === 'above' ? { bottom: placement.bottom } : { top: placement.top }),
        width: placement.width,
        maxHeight: placement.maxHeightPx,
        zIndex: RAPI_BUBBLE_Z,
        pointerEvents: 'auto',
        // Hidden rather than removed: out of the accessibility tree and out
        // of hit-testing, while the state and any request in flight stay.
        ...(open ? {} : { display: 'none' }),
      }}
      // No radius or border class: the bubble owns both, and its radius is
      // asymmetric where the tail leaves. `shadow-lg` not `shadow-xl` —
      // overlays get one elevation level (docs/design/ui-design-language.md).
      // One width for every mode, set from `placement` (448px, narrowed to
      // the window). It was 320px, which made the box too cramped to write a
      // request in (reported 2026-11-14). It used to widen for `consult`
      // alone, and the panel jumping size between modes read worse than the
      // cramped column did (2026-10-22), so it is wide everywhere instead.
      className="flex flex-col shadow-lg"
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

      <RapiModeHeader mode={mode} onBack={() => setMode(DEFAULT_MODE)} />

      {/* Going back to something asked earlier. The mode it went to still
          holds what it produced, so this is a jump rather than a replay —
          nothing is asked of the model again. On the conversation tab only:
          it is the home of what you have asked, and above a list of overdue
          tasks it is another bar between you and the answer. */}
      {mode === 'chat' && (
        <RapiHistory history={history} onPick={(entry) => setMode(entry.intent)} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The conversation tab's own prompt: it explains what the panel is
            and tells you to write in the box below. That is only true where
            writing a sentence is the point, so it stays on this tab —
            elsewhere it was taking the first two lines of the answer. It
            still goes once a sentence has been routed. */}
        {mode === 'chat' && !routed && (
          <>
            <p className="px-3 py-2.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              {ta('greeting')}
            </p>
            <RapiExamples onPick={pickExample} />
          </>
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

      {/* The box is on every mode. It was kept to the conversation while the
          tabs existed, because a form with a "write what you want" box under
          it read as two ways of doing the same thing (2026-10-22). With the
          tabs gone it is the only way, so it stays put: the next request can
          be written from wherever the last one landed. */}
      <RapiComposer
        routed={routed}
        mode={mode}
        hasOpenTask={hasTask}
        onRouted={handleRouted}
        seed={seed}
      />

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
