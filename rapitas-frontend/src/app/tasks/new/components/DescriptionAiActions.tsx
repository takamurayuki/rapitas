'use client';
/**
 * DescriptionAiActions
 *
 * The two AI drafts the new-task form offers, side by side under the
 * description they are both made from (#1557): a title, and the spec (goals,
 * constraints, the conditions the agent checks). They used to be two
 * identical "AI" buttons on two different accordion headers, saying neither
 * what they read nor what they would replace. Not responsible for the drafts
 * themselves (`useTaskFormActions`).
 */
import { Loader2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { HelpTip } from '@/components/ui/help-tip/HelpTip';

interface DescriptionAiActionsProps {
  /** Whether a description has been written / 説明が書かれているか */
  hasDescription: boolean;
  isGeneratingTitle: boolean;
  onGenerateTitle: () => void;
  isDerivingSpec: boolean;
  onDeriveSpec: () => void;
}

// NOTE: One short line (2026-11-16): the lead carries the AI glyph once, the
// buttons say only what they make, and what each one does, that it replaces
// what is entered and that it needs a description sit behind the ? and in the
// buttons' hint, instead of a second sentence that stayed on screen.
const BUTTON_CLASS =
  'flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

/**
 * @param props - Whether there is a description, and the two drafts / 説明の有無と2つの下書き
 */
export function DescriptionAiActions({
  hasDescription,
  isGeneratingTitle,
  onGenerateTitle,
  isDerivingSpec,
  onDeriveSpec,
}: DescriptionAiActionsProps) {
  const t = useTranslations('task');
  const actions = [
    {
      key: 'title',
      label: t('titleGenerate'),
      hint: t('titleGenerateTooltip'),
      busy: isGeneratingTitle,
      run: onGenerateTitle,
    },
    {
      key: 'spec',
      label: t('specDerive'),
      hint: t('specDeriveTooltip'),
      busy: isDerivingSpec,
      run: onDeriveSpec,
    },
  ];

  return (
    <div data-ai-drafts className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
        <Sparkles className="w-3.5 h-3.5 text-violet-500" aria-hidden="true" />
        {t('aiDraftLead')}
      </span>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          data-ai-draft={a.key}
          onClick={a.run}
          disabled={!hasDescription || a.busy}
          title={hasDescription ? a.hint : t('aiDraftNeedsDescription')}
          aria-label={`${t('aiDraftLead')} ${a.label}`}
          className={BUTTON_CLASS}
        >
          {a.busy && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          <span>{a.label}</span>
        </button>
      ))}
      <HelpTip label={t('aiDraftHelpLabel')}>{t('aiDraftHelp')}</HelpTip>
    </div>
  );
}
