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
import {
  TaskAsk,
  TaskConsult,
  TaskIntake,
  TaskTidy,
  TaskWatch,
  taskIdFromLocation,
} from './intake';
import { RAPI_BUBBLE_Z } from '@/lib/pane-layering';
import { RapiPrompt, type Routed } from './RapiPrompt';
import { BUBBLE_COLORS, SpeechBubble } from './SpeechBubble';

/**
 * What ラピ can be asked for, in the order the tabs show them.
 *
 * Five, not six: "AIで選ぶ" and "条件で選ぶ" were one job described twice and
 * are now the two instruments inside `tidy`. And `consult` is only offered
 * where it can work — it is the one mode that needs a task open, and a tab
 * whose whole content is "open a task first" spends a fifth of the bar
 * saying so.
 *
 * That is as far as per-page hiding goes, and it is worth being clear about:
 * four of the five are useful from anywhere, so context cannot be what keeps
 * this bar short as capabilities are added. What will is a single input that
 * routes by intent — she already reads intent for filing and for questions.
 */
const ALWAYS_MODES = ['watch', 'create', 'ask'] as const;
const PANEL_MODES = ['watch', 'create', 'ask', 'consult', 'tidy'] as const;
type PanelMode = (typeof PANEL_MODES)[number];

/**
 * The tabs to show, given whether a task is open.
 *
 * @param hasTask - Whether a task is open on the page or in the panel / タスクが開いているか
 * @returns The modes to offer, in order / 表示するモード
 */
export function visibleModes(hasTask: boolean): readonly PanelMode[] {
  return hasTask ? PANEL_MODES : ([...ALWAYS_MODES, 'tidy'] as const);
}

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
}: RapiAvatarPanelProps) {
  const t = useTranslations('banner');
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');

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
  // panel on a tab that is no longer in the bar.
  useEffect(() => {
    if (!modes.includes(mode)) setMode('watch');
  }, [modes, mode]);

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

  useEffect(() => {
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
  }, [onClose]);

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
      }}
      // No radius or border class: the bubble owns both, and its radius is
      // asymmetric where the tail leaves. `shadow-lg` not `shadow-xl` —
      // overlays get one elevation level (docs/design/ui-design-language.md).
      className={`flex max-h-[70vh] flex-col shadow-lg ${wide ? 'w-[34rem]' : 'w-80'}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <h2 className="flex-1 text-xs font-semibold text-zinc-700 dark:text-zinc-200">{heading}</h2>
        <span className="text-[11px] text-zinc-400">
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The front door, above the tabs: typing is the first thing offered
            and the tabs are the shortcuts beside it. */}
        <RapiPrompt hasOpenTask={hasTask} onRouted={handleRouted} />

        {/* Where she took it. Without this a misroute looks like the feature
            simply doing something else. */}
        {routed && routed.intent === mode && (
          <p className="px-2 pt-1 text-[10px] text-zinc-400">
            {ta('prompt.tookItAs', { where: tm(routed.intent), reason: routed.reason })}
          </p>
        )}

        <div className="flex gap-1 border-b border-zinc-200 px-2 pt-2 dark:border-zinc-700">
          {modes.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-t-md px-2.5 py-1 text-xs transition-colors ${
                mode === value
                  ? 'bg-zinc-100 font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {tm(value)}
            </button>
          ))}
        </div>

        {mode === 'watch' && <TaskWatch />}
        {mode === 'create' && <TaskIntake handedOver={handedOver('create')} />}
        {mode === 'ask' && <TaskAsk handedOver={handedOver('ask')} />}
        {mode === 'consult' && <TaskConsult />}
        {mode === 'tidy' && <TaskTidy />}
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
