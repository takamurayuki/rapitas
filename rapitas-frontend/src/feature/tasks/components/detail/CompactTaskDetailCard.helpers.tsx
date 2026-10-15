/**
 * CompactTaskDetailCard.helpers
 *
 * Small standalone pieces used by CompactTaskDetailCard: an
 * accordion-aware RecurrenceSelector wrapper and a datetime-local
 * formatting helper. Extracted to keep the card component under the size
 * limit; behavior is unchanged.
 */
'use client';
import { type Task } from '@/types';
import { useAccordionContext } from '@/components/ui/accordion/Accordion';
import RecurrenceSelector from '@/feature/tasks/components/recurrence/RecurrenceSelector';

/**
 * Wrapper for RecurrenceSelector that can close the accordion
 */
export function RecurrenceSelectorWithAccordionClose({
  task,
  onTaskUpdated,
}: {
  task: Task;
  onTaskUpdated?: () => void;
}) {
  const { toggleItem } = useAccordionContext();

  return (
    <RecurrenceSelector
      taskId={task.id}
      isRecurring={task.isRecurring ?? false}
      recurrenceRule={task.recurrenceRule ?? null}
      recurrenceEndAt={task.recurrenceEndAt ?? null}
      onUpdate={onTaskUpdated ?? (() => {})}
      onClose={() => toggleItem('recurrence')}
      inline={true}
    />
  );
}

/** Converts a UTC ISO string to a value suitable for a datetime-local input. */
export function toDateTimeLocal(isoUtcString: string): string {
  const d = new Date(isoUtcString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
