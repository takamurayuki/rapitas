'use client';
/**
 * TaskSpecEditSection
 *
 * The task detail's "仕様" accordion section (#1555): the goals, what is out
 * of scope, the constraints and the deliverable at a glance, and an editor
 * for the whole spec — the completion criteria included — with the same
 * fields and rule as the new-task form. This is where a development-project
 * task stopped by the intake gate for a missing goal or criterion gets them.
 * The criteria themselves stay listed by TaskAcceptanceCriteriaSection.
 */
import { useTranslations } from 'next-intl';
import { ClipboardList, Pencil } from 'lucide-react';
import type { Task } from '@/types';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion/Accordion';
import { parseCriteriaList } from '../detail/task-criteria.utils';
import { TaskSpecFields } from './TaskSpecFields';
import { DELIVERABLE_OPTIONS, type DeliverableOption } from './task-spec-validation';
import { useTaskSpecEditor } from './useTaskSpecEditor';

const SECTION_ID = 'spec';

interface TaskSpecEditSectionProps {
  task: Task;
  /** Whether the task's theme is a development project / 開発プロジェクトか */
  isDevelopment: boolean;
  /** Reload after a save / 保存後の再読み込み */
  onTaskUpdated?: () => void;
}

/** One labelled list, or nothing when it is empty. */
function SpecList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1">{label}</p>
      <ul className="list-disc pl-5 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * @param props - The task, whether it is a development project, and the reload / タスクと再読み込み
 */
export default function TaskSpecEditSection({
  task,
  isDevelopment,
  onTaskUpdated,
}: TaskSpecEditSectionProps) {
  const t = useTranslations('task');
  const editor = useTaskSpecEditor(task, isDevelopment, onTaskUpdated);
  const goals = parseCriteriaList(task.goals);
  const outOfScope = parseCriteriaList(task.outOfScope);
  const constraints = parseCriteriaList(task.constraints);
  const deliverable: DeliverableOption = (DELIVERABLE_OPTIONS as readonly string[]).includes(
    task.deliverable ?? '',
  )
    ? (task.deliverable as DeliverableOption)
    : 'pr';

  return (
    <AccordionItem id={SECTION_ID}>
      <AccordionTrigger id={SECTION_ID} icon={<ClipboardList className="w-4 h-4" />}>
        {t('specTitle')}
      </AccordionTrigger>
      <AccordionContent id={SECTION_ID}>
        {editor.editing ? (
          <div className="space-y-3">
            <TaskSpecFields
              {...editor.values}
              isDevelopment={isDevelopment}
              specIssues={editor.specIssues}
              idPrefix={`task-${task.id}-spec`}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={editor.cancel}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t('specCancel')}
              </button>
              <button
                type="button"
                onClick={() => void editor.save()}
                disabled={editor.saving}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('specSave')}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <SpecList label={t('specGoals')} items={goals} />
            <SpecList label={t('specOutOfScope')} items={outOfScope} />
            <SpecList label={t('specConstraints')} items={constraints} />
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-2">
                {t('specDeliverable')}
              </span>
              {t(`deliverable.${deliverable}`)}
            </p>
            {isDevelopment && goals.length === 0 && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {t('specErrorGoals')}
              </p>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={editor.begin}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
              >
                <Pencil className="w-3.5 h-3.5" />
                {t('specEdit')}
              </button>
            </div>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
