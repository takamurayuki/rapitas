'use client';
/**
 * TaskAcceptanceCriteriaSection
 *
 * Read-only "完了条件" accordion section of the desktop task detail card. It
 * keeps the jury-checked criteria (acceptanceCriteria) apart from the checks
 * only the person can make (userAcceptanceChecks), mirroring the mobile
 * TaskAcceptanceCriteriaSection. Editing stays in the create/edit forms.
 */
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import type { Task } from '@/types';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion/Accordion';
import { parseCriteriaList } from './task-criteria.utils';

const SECTION_ID = 'criteria';

interface TaskAcceptanceCriteriaSectionProps {
  /** Only the two criteria columns are read. */
  task: Pick<Task, 'acceptanceCriteria' | 'userAcceptanceChecks'>;
}

/** Colour pairs match the mobile subheadings (violet = jury, teal = person). */
const SUBHEADING_CLASS = {
  jury: 'bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300',
  user: 'bg-teal-50 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
} as const;

function Subheading({ kind, label }: { kind: keyof typeof SUBHEADING_CLASS; label: string }) {
  return (
    <span
      className={`mb-1.5 inline-block rounded px-2 py-0.5 text-xs font-semibold ${SUBHEADING_CLASS[kind]}`}
    >
      {label}
    </span>
  );
}

function NumberedList({ items, testId }: { items: string[]; testId: string }) {
  return (
    <ol data-testid={testId} className="mb-1.5 space-y-1">
      {items.map((item, i) => (
        <li key={`${i}-${item}`} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <span aria-hidden className="w-4 shrink-0 text-right tabular-nums text-zinc-400">
            {i + 1}.
          </span>
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Render the task's completion criteria, or nothing when it has none.
 *
 * @param props.task - Task holding the criteria columns / 完了条件の列を持つタスク
 * @returns The accordion item, or null when both lists are empty / 条件が無ければ null
 */
export default function TaskAcceptanceCriteriaSection({
  task,
}: TaskAcceptanceCriteriaSectionProps) {
  const t = useTranslations('task.acceptanceCriteriaSection');
  const criteria = parseCriteriaList(task.acceptanceCriteria);
  const userChecks = parseCriteriaList(task.userAcceptanceChecks);
  if (criteria.length === 0 && userChecks.length === 0) return null;

  // Tasks without person checks predate the split; show them as before, with
  // no subheadings (same rule as the mobile section).
  const split = userChecks.length > 0;
  const mutedClass = 'text-xs text-zinc-500 dark:text-zinc-400';

  return (
    <AccordionItem id={SECTION_ID}>
      <AccordionTrigger
        id={SECTION_ID}
        icon={<ListChecks className="w-4 h-4" />}
        badge={
          <span className="px-1.5 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full">
            {criteria.length + userChecks.length}
          </span>
        }
      >
        {t('heading')}
      </AccordionTrigger>
      <AccordionContent id={SECTION_ID}>
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-4 space-y-3">
          <div>
            {split && <Subheading kind="jury" label={t('juryHeading')} />}
            {criteria.length === 0 ? (
              <p className={mutedClass}>{t('juryEmpty')}</p>
            ) : (
              <>
                <NumberedList items={criteria} testId="task-criteria-jury-list" />
                <p className={mutedClass}>{t('juryNote')}</p>
              </>
            )}
          </div>
          {split && (
            <div>
              <Subheading kind="user" label={t('userHeading')} />
              <NumberedList items={userChecks} testId="task-criteria-user-list" />
              <p className={mutedClass}>{t('userNote')}</p>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
