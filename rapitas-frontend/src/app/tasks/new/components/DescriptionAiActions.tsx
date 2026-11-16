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

interface DescriptionAiActionsProps {
  /** Whether a description has been written / 説明が書かれているか */
  hasDescription: boolean;
  isGeneratingTitle: boolean;
  onGenerateTitle: () => void;
  isDerivingSpec: boolean;
  onDeriveSpec: () => void;
}

const BUTTON_CLASS =
  'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900 disabled:opacity-40 disabled:cursor-not-allowed';

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
    <div data-ai-drafts className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{t('aiDraftLead')}</span>
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          data-ai-draft={a.key}
          onClick={a.run}
          disabled={!hasDescription || a.busy}
          title={a.hint}
          aria-label={`${t('aiDraftLead')} ${a.label}`}
          className={BUTTON_CLASS}
        >
          {a.busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span>{a.label}</span>
        </button>
      ))}
      {!hasDescription && (
        <span className="text-xs text-zinc-400 dark:text-zinc-500">
          {t('aiDraftNeedsDescription')}
        </span>
      )}
    </div>
  );
}
