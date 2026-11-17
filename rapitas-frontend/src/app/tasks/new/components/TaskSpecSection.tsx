'use client';
/**
 * TaskSpecSection
 *
 * The new-task form's spec accordion around the shared spec fields (#1555).
 * The AI draft of the spec sits under the description it reads (#1557). In a
 * development project the section opens by itself, and again when a submit
 * is refused, so the required fields are in view.
 * Not responsible for the fields themselves (`feature/tasks/components/spec`).
 */
import { ClipboardList } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CompactAccordionGroup } from '@/components/ui/accordion';
import { TaskSpecFields, type TaskSpecFieldsProps } from '@/feature/tasks/components/spec';

/** Props of {@link TaskSpecSection}. */
export type TaskSpecSectionProps = TaskSpecFieldsProps;

/**
 * @param fields - Spec values, setters and the required state / 仕様の値と必須の状態
 */
export function TaskSpecSection(fields: TaskSpecSectionProps) {
  const t = useTranslations('task');
  const hasIssues = Object.keys(fields.specIssues).length > 0;

  return (
    <CompactAccordionGroup
      // Remounted when the requirement or a refusal appears, so it opens then.
      key={`spec-${fields.isDevelopment}-${hasIssues}`}
      title={t('specTitle')}
      icon={<ClipboardList className="w-3.5 h-3.5" />}
      defaultExpanded={fields.isDevelopment || hasIssues}
    >
      <TaskSpecFields {...fields} />
    </CompactAccordionGroup>
  );
}
