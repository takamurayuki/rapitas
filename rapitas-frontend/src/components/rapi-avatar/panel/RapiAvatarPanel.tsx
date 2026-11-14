'use client';
/**
 * RapiAvatarPanel
 *
 * What the avatar opens: a conversation with her — laid out after the
 * mobile app's ラピ screen — above the box you write in, and the running
 * and interrupted executions with the actions that were on the
 * resumable-executions banner.
 *
 * That banner used to sit in the corner permanently, saying the same thing
 * the avatar now says and taking the same space. The card is gone; its
 * contents live here, one click away, so nothing it could do was lost —
 * resuming an interrupted execution is reachable nowhere else in the app.
 *
 * The executions come from `useResumableExecutions`, which the host owns so
 * it runs once; the conversation from `useRapiConversation`.
 */
import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { ExecutionItem } from '../../resumable-executions/ExecutionItem';
import type { ResumableExecution } from '../../resumable-executions/types';
import { taskIdFromLocation } from '../intake';
import { RAPI_BUBBLE_Z } from '@/lib/pane-layering';
import type { PanelPlacement } from '../avatar/drag';
import { BUBBLE_COLORS, SpeechBubble } from '../avatar/SpeechBubble';
import { RapiPrompt } from './RapiPrompt';
import { RapiThread, useRapiConversation } from './conversation';
import { RapiSpaceSwitcher, useRapiSpaces } from './spaces';
import type { PromptDestination } from './RapiPrompt';
import { usePanelPresence } from './usePanelPresence';

/**
 * How tall the panel is when the window has room.
 *
 * A conversation needs a fixed frame to scroll inside: sized to its
 * content, the panel grew with every line and the box jumped down the
 * screen as she answered.
 */
const PANEL_HEIGHT_PX = 600;

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

  // Whether `consult` exists right now. ラピ is in the app shell with no
  // props from the page, so the open task comes from the address bar —
  // `/tasks/42` for the page and `/?panel=42` for the slide panel.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hasTask = taskIdFromLocation(pathname, searchParams?.get('panel') ?? null) !== null;

  const tm = useTranslations('rapiAvatar.mode');
  const tsp = useTranslations('rapiAvatar.spaces');
  const routedText = useCallback(
    (intent: PromptDestination, reason: string) =>
      ta('prompt.tookItAs', { where: tm(intent), reason }),
    [ta, tm],
  );

  // The conversation is kept in the mobile app's spaces, so the phone and
  // the desktop read the same history (asked 2026-11-14).
  const spaces = useRapiSpaces();
  const talk = useRapiConversation({
    hasOpenTask: hasTask,
    greeting: ta('greeting'),
    failedText: ta('prompt.failed'),
    routedText,
    onSave: spaces.save,
  });

  // Back where the last visit left off. Once, on the first open: the panel
  // stays mounted after that. Put in front rather than swapped in: the
  // history can arrive after a first sentence was already sent, and that
  // sentence was saved to this same space (it is opened before the read).
  const { restore } = spaces;
  const { replace, cancel, prepend } = talk;
  useEffect(() => {
    void restore().then((lines) => {
      if (lines) prepend(lines);
    });
  }, [restore, prepend]);

  // What is on its way is called off before the switch, so a cancelled
  // sentence is put back into the conversation it was said in.
  const openSpace = async (id: number) => {
    cancel();
    const lines = await spaces.open(id);
    if (lines) replace(lines);
  };
  const startNew = () => {
    cancel();
    spaces.startNew();
    replace([]);
  };

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
        height: Math.min(PANEL_HEIGHT_PX, placement.maxHeightPx),
        zIndex: RAPI_BUBBLE_Z,
        pointerEvents: 'auto',
        // Hidden rather than removed: out of the accessibility tree and out
        // of hit-testing, while the state and any request in flight stay.
        ...(open ? {} : { display: 'none' }),
      }}
      // No radius or border class: the bubble owns both, and its radius is
      // asymmetric where the tail leaves. `shadow-lg` not `shadow-xl` —
      // overlays get one elevation level (docs/design/ui-design-language.md).
      // Width from `placement` (448px, narrowed to the window). It was
      // 320px, which made the box too cramped to write a request in
      // (reported 2026-11-14).
      className="flex flex-col shadow-lg"
    >
      {/* No name here any more. A bar reading 「ラピ」 above her own speech
          bubble said nothing the bubble did not: she is the thing you just
          clicked. Her greeting opens the conversation instead. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <RapiSpaceSwitcher
          spaces={spaces.spaces}
          currentId={spaces.currentId}
          currentTitle={spaces.currentTitle}
          onOpenList={() => void spaces.refresh()}
          onPick={(id) => void openSpace(id)}
          onNew={startNew}
        />
        {(runningCount > 0 || interruptedCount > 0) && (
          <span className="shrink-0 text-[11px] text-zinc-400">
            {runningCount > 0 && t('runningCount', { count: runningCount })}
            {runningCount > 0 && interruptedCount > 0 && ' / '}
            {interruptedCount > 0 && t('resumableCount', { count: interruptedCount })}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeAll')}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {spaces.problem && (
        <p
          data-rapi-space-problem={spaces.problem}
          className="shrink-0 border-b border-zinc-200 px-3 py-1.5 text-[11px] text-amber-700 dark:border-zinc-700 dark:text-amber-400"
        >
          {tsp(`problem.${spaces.problem}`)}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {executions.length > 0 && (
          <div className="space-y-2 border-b border-zinc-200 p-2 dark:border-zinc-700">
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
        )}
        <RapiThread
          messages={talk.messages}
          sending={talk.sending}
          rethinkAsPlan={talk.rethinkAsPlan}
        />
      </div>

      <RapiPrompt
        text={talk.text}
        onChange={talk.setText}
        sending={talk.sending}
        onSend={() => void talk.send()}
        onCancel={talk.cancel}
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
