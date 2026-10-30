'use client';
/**
 * RapiProfileInterview
 *
 * The other way to fill in the self-introduction: let ラピ ask.
 *
 * The boxes above are the hardest version of the question — they ask the
 * user to work out for themselves which facts a planner needs, and to write
 * them in one sitting. This asks instead, with choices, and comes back for
 * another round that digs into what the last one turned up (#1281).
 *
 * The asking itself is the roadmap interview's own component, not a second
 * copy of it: one question at a time, each answered line reopenable, the
 * recommendation pre-selected. A divergent copy of an interaction the user
 * already knows is the thing the splitting policy forbids, and the behaviour
 * it standardises — noticing the wrong answer two questions later — matters
 * more here, where the subject is their own life.
 *
 * Applies nothing by itself. The draft is shown, and it reaches the boxes
 * only when the user picks replacing or appending: they may have written a
 * paragraph by hand, and this must not be what loses it.
 */
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import { RoadmapQuestions } from '@/components/rapi-avatar/intake/RoadmapQuestions';
import { useProfileInterview, type ProfileDraft } from './use-profile-interview';

/** How an applied draft meets what is already in the box. */
export type ApplyMode = 'replace' | 'append';

interface Props {
  /** What the facts box currently says. / 事実欄の現在の内容 */
  profile: string;
  /** What the character box currently says. / 人となり欄の現在の内容 */
  character: string;
  /** Hands the draft to the card, which owns the boxes. / 下書きをカードへ渡す */
  onApply: (draft: ProfileDraft, mode: ApplyMode) => void;
}

const SECONDARY =
  'rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * @param props - The current boxes and where an applied draft should go
 */
export default function RapiProfileInterview({ profile, character, onApply }: Props) {
  const t = useTranslations('settings.rapiProfile.interview');
  const iv = useProfileInterview({ profile, character });

  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('hint')}</p>
        {iv.asked.length === 0 && (
          <button type="button" onClick={iv.start} disabled={iv.busy !== null} className={PRIMARY}>
            <Sparkles className="h-3.5 w-3.5" />
            {t('start')}
          </button>
        )}
      </div>

      {iv.busy !== null && (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t(iv.busy === 'asking' ? 'asking' : 'composing')}
        </p>
      )}

      {iv.trouble !== null && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">{t(iv.trouble)}</p>
      )}

      {iv.asked.length > 0 && (
        <div className="mt-3 space-y-3">
          <RoadmapQuestions
            questions={iv.asked}
            answers={iv.answers}
            setAnswers={iv.setAnswers}
            density="comfortable"
          />
          <div className="flex flex-wrap items-center gap-2">
            {iv.canGoDeeper && (
              <button
                type="button"
                onClick={iv.deeper}
                disabled={iv.busy !== null}
                className={SECONDARY}
              >
                {t('deeper')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void iv.compose()}
              disabled={iv.busy !== null}
              className={PRIMARY}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('compose')}
            </button>
            <button type="button" onClick={iv.reset} className={SECONDARY}>
              {t('again')}
            </button>
          </div>
        </div>
      )}

      {iv.draft && (
        <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
          <h4 className="mb-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
            {t('draftTitle')}
          </h4>
          {/* Both halves, labelled, because they land in different boxes and
              one of them may be absent — she writes only what the answers
              support. */}
          {iv.draft.profile && <Half label={t('draftProfile')} body={iv.draft.profile} />}
          {iv.draft.character && <Half label={t('draftCharacter')} body={iv.draft.character} />}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => iv.draft && onApply(iv.draft, 'replace')}
              className={PRIMARY}
            >
              {t('replace')}
            </button>
            <button
              type="button"
              onClick={() => iv.draft && onApply(iv.draft, 'append')}
              className={SECONDARY}
            >
              {t('append')}
            </button>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">{t('applyNote')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One labelled half of the draft.
 *
 * @param props - The heading and the text she wrote / 見出しと本文
 */
function Half({ label, body }: { label: string; body: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="whitespace-pre-wrap text-xs text-zinc-800 dark:text-zinc-100">{body}</p>
    </div>
  );
}
