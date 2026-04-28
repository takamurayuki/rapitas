'use client';
// WorkflowSection
import { useTranslations } from 'next-intl';
import type { WorkflowMode } from '@/types';
import CompactWorkflowSelector from '@/components/workflow/CompactWorkflowSelector';

interface WorkflowSectionProps {
  workflowMode: WorkflowMode;
  isWorkflowModeOverride: boolean;
  autoComplexityAnalysis: boolean;
  /** Called when the user changes the workflow mode or override flag. */
  onModeChange: (mode: WorkflowMode, isOverride: boolean) => void;
}

/**
 * Body of the workflow-mode accordion on the new-task page.
 *
 * @param props.workflowMode - Current mode value / 現在のワークフローモード
 * @param props.isWorkflowModeOverride - Whether the user has manually overridden the mode / 手動上書きフラグ
 * @param props.autoComplexityAnalysis - Global setting for auto-complexity analysis / 自動複雑度解析設定
 * @param props.onModeChange - Change handler / 変更ハンドラ
 */
export function WorkflowSection({
  workflowMode,
  isWorkflowModeOverride,
  autoComplexityAnalysis,
  onModeChange,
}: WorkflowSectionProps) {
  const t = useTranslations('task');

  return (
    <div className="space-y-3">
      <CompactWorkflowSelector
        taskId={0}
        currentMode={workflowMode}
        isOverridden={isWorkflowModeOverride}
        complexityScore={null}
        autoComplexityAnalysis={autoComplexityAnalysis}
        onModeChange={onModeChange}
        disabled={false}
        showAnalyzeButton={false}
      />
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <strong>{t('workflowModeAbout')}</strong> {t('workflowModeExplanation')}
        </p>
      </div>
    </div>
  );
}
