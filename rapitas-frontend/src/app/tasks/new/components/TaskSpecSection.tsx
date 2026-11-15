'use client';
/**
 * TaskSpecSection
 *
 * The new-task form's spec accordion: the shared spec fields (#1555) plus the
 * "AIで抽出" button. In a development project the section opens by itself,
 * and again when a submit is refused, so the required fields are in view.
 * Not responsible for the fields themselves (`feature/tasks/components/spec`).
 */
import { Loader2, Sparkles, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CompactAccordionGroup } from '@/components/ui/accordion';
import { TaskSpecFields, type TaskSpecFieldsProps } from '@/feature/tasks/components/spec';

/** Props of {@link TaskSpecSection}. */
export interface TaskSpecSectionProps extends TaskSpecFieldsProps {
  canDerive: boolean;
  isDeriving: boolean;
  onDerive: () => void;
}

/**
 * @param props - Spec values, setters, required state and the derive action / 仕様と抽出操作
 */
export function TaskSpecSection({
  canDerive,
  isDeriving,
  onDerive,
  ...fields
}: TaskSpecSectionProps) {
  const t = useTranslations('task');
  const hasIssues = Object.keys(fields.specIssues).length > 0;

  return (
    <CompactAccordionGroup
      // Remounted when the requirement or a refusal appears, so it opens then.
      key={`spec-${fields.isDevelopment}-${hasIssues}`}
      title={t('specTitle')}
      icon={<Target className="w-3.5 h-3.5" />}
      defaultExpanded={fields.isDevelopment || hasIssues}
      headerExtra={
        <button
          type="button"
          onClick={onDerive}
          disabled={!canDerive || isDeriving}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('specDeriveTooltip')}
        >
          {isDeriving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          <span>{t('specDerive')}</span>
        </button>
      }
    >
      <TaskSpecFields {...fields} />
    </CompactAccordionGroup>
  );
}
