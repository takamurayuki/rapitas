'use client';
/**
 * RapiThread
 *
 * ラピ's conversation, drawn as one: what you said on the right, what she
 * said on the left, and between them the note saying where a sentence went
 * with that mode's card under it. Laid out after the mobile app's ラピ
 * screen, so the two clients read the same.
 *
 * It replaces a panel that switched between modes. Each answer now stays
 * where it came in, so going back to an earlier one is scrolling up, not a
 * tab or a history row — and a second request of the same kind gets its
 * own card instead of replacing the first.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { TaskAsk, TaskConsult, TaskIntake, TaskRoadmap, TaskTidy, TaskWatch } from '../../intake';
import { TaskChange } from '../../intake/change';
import { MODE_ICONS } from '../rapi-modes';
import type { PromptDestination } from '../RapiPrompt';
import type { RapiMessage } from './conversation-types';

/**
 * Her replies are Markdown (headings, lists, bold — the same text the mobile
 * app renders as Markdown), drawn with the app's shared renderer.
 *
 * Loaded on demand: ラピ is in the root layout, so a static import would put
 * react-markdown in the chunk every page loads (#1528 kept that under 500 KB).
 * The first reply waits a moment for it; every later one is drawn at once.
 */
const MarkdownView = dynamic(
  () => import('@/components/markdown/MarkdownView').then((m) => m.MarkdownView),
  { loading: () => null },
);

/**
 * What each mode's card draws.
 *
 * `watch`, `tidy` and `consult` are places rather than questions, so they
 * are not handed the sentence; the others act on it.
 */
const CARDS: Record<PromptDestination, (handedOver?: string) => ReactNode> = {
  watch: () => <TaskWatch />,
  create: (h) => <TaskIntake handedOver={h} />,
  ask: (h) => <TaskAsk handedOver={h} />,
  consult: () => <TaskConsult />,
  tidy: () => <TaskTidy />,
  roadmap: (h) => <TaskRoadmap handedOver={h} />,
  change: (h) => <TaskChange handedOver={h} />,
};

interface Props {
  messages: RapiMessage[];
  /** Whether she is working on the last sentence. / 応答待ちか */
  sending: boolean;
  rethinkAsPlan: (sentence: string) => void;
}

function Bubble({ from, children }: { from: 'user' | 'assistant'; children: ReactNode }) {
  const mine = from === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        data-rapi-line={from}
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
          mine
            ? 'rounded-br-sm bg-indigo-600 text-white'
            : 'rounded-bl-sm bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A card the mobile app saved, shown as the record it is.
 *
 * Its snapshot is the phone's; drawing a live card from it here could re-run
 * what the phone already did, so the web shows what it said and names the
 * kind of card it was.
 */
function ArchivedCard({ message }: { message: RapiMessage }) {
  const ts = useTranslations('rapiAvatar.spaces');
  const kind = message.archivedKind as string;
  const known = ['answer', 'change', 'roadmap', 'tidy', 'companion'].includes(kind);
  return (
    <div
      data-rapi-archived={kind}
      className="rounded-xl border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700"
    >
      <p className="text-[11px] text-zinc-400">
        {ts('archived', { kind: known ? ts(`kind.${kind}`) : kind })}
      </p>
      {message.text && (
        <p className="mt-1 text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {message.text}
        </p>
      )}
    </div>
  );
}

function RoutedLine({
  message,
  rethinkAsPlan,
}: {
  message: RapiMessage;
  rethinkAsPlan: (sentence: string) => void;
}) {
  const ta = useTranslations('rapiAvatar');
  const tm = useTranslations('rapiAvatar.mode');
  const intent = message.intent as PromptDestination;
  const Icon = MODE_ICONS[intent];
  return (
    <div data-rapi-card={intent} className="space-y-1.5">
      <div className="flex items-baseline gap-2 px-1">
        <p className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-zinc-400">
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{ta('prompt.tookItAs', { where: tm(intent), reason: message.reason ?? '' })}</span>
        </p>
        {/* The one correction worth offering. Routing is a model call and
            will sometimes be wrong, and the roadmap is the one a misroute
            most often misses ("英語を毎日続けられるようにしたい" read as one
            task). Any other turn is a rewording away. */}
        {intent !== 'roadmap' && message.handedOver && (
          <button
            type="button"
            onClick={() => rethinkAsPlan(message.handedOver as string)}
            className="shrink-0 text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {ta('prompt.ratherPlan')}
          </button>
        )}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        {CARDS[intent](message.handedOver)}
      </div>
    </div>
  );
}

/**
 * @param props - The conversation, whether an answer is coming, and the plan correction
 */
export function RapiThread({ messages, sending, rethinkAsPlan }: Props) {
  const t = useTranslations('rapiAvatar.prompt');
  const end = useRef<HTMLDivElement>(null);

  // Keeps the newest line in view, as a chat does. Keyed on the count so a
  // card that grows as its answer arrives does not yank the scroll back.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, sending]);

  return (
    <div className="space-y-3 px-3 py-3" aria-live="polite">
      {messages.map((m) => {
        if (m.archivedKind) return <ArchivedCard key={m.id} message={m} />;
        if (m.role === 'system') {
          return m.intent ? (
            <RoutedLine key={m.id} message={m} rethinkAsPlan={rethinkAsPlan} />
          ) : (
            <p
              key={m.id}
              data-rapi-line="system"
              className={`px-1 text-xs ${m.failed ? 'text-amber-700 dark:text-amber-400' : 'text-zinc-400'}`}
            >
              {m.text}
            </p>
          );
        }
        return (
          <Bubble key={m.id} from={m.role}>
            {m.role === 'assistant' && !m.localOnly ? (
              <MarkdownView content={m.text} className="prose-p:my-1 prose-headings:my-2" />
            ) : (
              m.text
            )}
          </Bubble>
        );
      })}
      {sending && (
        <Bubble from="assistant">
          <span className="text-zinc-400" data-rapi-typing="true">
            {t('thinking')}
          </span>
        </Bubble>
      )}
      <div ref={end} />
    </div>
  );
}
