'use client';
/**
 * RapiExamples
 *
 * A few things you could say to ラピ, offered on the conversation before
 * anything has been asked.
 *
 * The tab bar used to double as the list of what she can do. Without it, an
 * empty box says nothing about her range, so these say it in the only form
 * that matters here: sentences. Picking one puts it in the box rather than
 * sending it, so it reads as an example to edit, not a hidden button.
 */
import { useTranslations } from 'next-intl';

/** Keys under `rapiAvatar.examples`, one per kind of request she routes. */
export const EXAMPLE_KEYS = ['watch', 'create', 'ask', 'tidy', 'roadmap'] as const;

interface Props {
  /** Put the sentence in the box. / 入力欄に入れる */
  onPick: (text: string) => void;
}

/**
 * @param props - What to do with the example that was picked
 */
export function RapiExamples({ onPick }: Props) {
  const ta = useTranslations('rapiAvatar');
  const te = useTranslations('rapiAvatar.examples');

  return (
    <div className="space-y-1.5 px-3 pb-3" aria-label={ta('examplesLabel')}>
      <p className="text-[11px] text-zinc-400">{ta('examplesLabel')}</p>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            data-rapi-example={key}
            onClick={() => onPick(te(key))}
            className="rounded-full border border-zinc-200 px-2.5 py-1 text-left text-xs text-zinc-600 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-200"
          >
            {te(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
