/**
 * WorkflowModeChip
 *
 * Shows the task's workflow mode and complexity score as a coloured chip.
 * Not responsible for assessing or changing the mode.
 */
import { CircleSmall, Diamond, Pyramid, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';

// Colour + icon the complexity chip by workflow mode. A cohesive shape
// progression for 簡単/標準/高度: CircleSmall (a small dot) → Diamond → Pyramid
// (layered/hierarchical = complex). Colours go emerald → blue → rose (easy→hard).
const MODE_STYLES: Record<string, { chip: string; icon: LucideIcon }> = {
  lightweight: {
    chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: CircleSmall,
  },
  standard: {
    chip: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Diamond,
  },
  comprehensive: {
    chip: 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    icon: Pyramid,
  },
};

/**
 * Mode chip; renders nothing when neither a mode nor a score is known.
 *
 * @param props.task - Task whose mode is shown / 対象タスク
 */
export default function WorkflowModeChip({ task }: { task: Task }) {
  const t = useTranslations('workflow');
  const MODE_LABELS: Record<string, string> = {
    lightweight: t('modeLightweight'),
    standard: t('modeStandard'),
    comprehensive: t('modeComprehensive'),
  };
  const complexity = task?.complexityScore;
  const modeLabel = task?.workflowMode
    ? (MODE_LABELS[task.workflowMode] ?? task.workflowMode)
    : null;
  if (!modeLabel && complexity == null) return null;
  const modeStyle = task?.workflowMode ? MODE_STYLES[task.workflowMode] : undefined;
  // Brand-coloured fallback keeps the chip visible when the mode is unknown.
  const complexityChipClass =
    modeStyle?.chip ?? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
  const ComplexityIcon = modeStyle?.icon ?? Diamond;

  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${complexityChipClass}`}
      title={
        modeLabel
          ? task?.workflowModeOverride
            ? t('taskWorkflowSection.modeTooltipManual', { mode: modeLabel })
            : t('taskWorkflowSection.modeTooltipAuto', { mode: modeLabel })
          : undefined
      }
    >
      <ComplexityIcon className="h-3.5 w-3.5" />
      {modeLabel ?? t('title')}
      {complexity != null
        ? t('taskWorkflowSection.complexitySuffix', { score: Math.round(complexity) })
        : // Not yet assessed: the score now comes exclusively from the
          // research agent's code-grounded evaluation — show a pending
          // "-" instead of hiding the field (or a heuristic guess).
          t('taskWorkflowSection.complexityPendingSuffix')}
      {task?.workflowModeOverride ? t('taskWorkflowSection.manualSuffix') : ''}
    </span>
  );
}
