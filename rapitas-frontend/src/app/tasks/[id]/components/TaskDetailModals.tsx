'use client';
import type { Task, DeveloperModeConfig, WorkflowFile } from '@/types';
import GlobalPomodoroModal from '@/feature/tasks/pomodoro/GlobalPomodoroModal';
import { DeveloperModeConfigModal } from '@/feature/developer-mode/components/DeveloperModeConfig';
import SaveAsTemplateDialog from '@/feature/tasks/components/dialog/SaveAsTemplateDialog';
import PlanApprovalModal from '@/components/workflow/PlanApprovalModal';
import { useTranslations } from 'next-intl';

interface TaskDetailModalsProps {
  task: Task;
  taskId: number;
  showPomodoroModal: boolean;
  onClosePomodoroModal: () => void;
  showDevModeConfig: boolean;
  onCloseDevModeConfig: () => void;
  devModeConfig: DeveloperModeConfig | null;
  updateDevModeConfig: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  selectedAgentConfigId: number | null;
  onAgentConfigChange: (id: number | null) => void;
  showSaveTemplateDialog: boolean;
  onCloseSaveTemplateDialog: () => void;
  showPlanApprovalModal: boolean;
  onClosePlanApprovalModal: () => void;
  planFile: WorkflowFile | null;
  onApprovalComplete: (approved: boolean, feedback?: string) => void;
}

export default function TaskDetailModals({
  task,
  taskId,
  showPomodoroModal,
  onClosePomodoroModal,
  showDevModeConfig,
  onCloseDevModeConfig,
  devModeConfig,
  updateDevModeConfig,
  selectedAgentConfigId,
  onAgentConfigChange,
  showSaveTemplateDialog,
  onCloseSaveTemplateDialog,
  showPlanApprovalModal,
  onClosePlanApprovalModal,
  planFile,
  onApprovalComplete,
}: TaskDetailModalsProps) {
  const t = useTranslations('task');
  return (
    <>
      <GlobalPomodoroModal
        isOpen={showPomodoroModal}
        onClose={onClosePomodoroModal}
        taskId={task?.id}
        taskTitle={task?.title}
      />

      <DeveloperModeConfigModal
        config={devModeConfig}
        isOpen={showDevModeConfig}
        onClose={onCloseDevModeConfig}
        onSave={updateDevModeConfig}
        selectedAgentConfigId={selectedAgentConfigId}
        onAgentConfigChange={onAgentConfigChange}
        taskId={taskId}
      />

      {task && (
        <SaveAsTemplateDialog
          task={task}
          isOpen={showSaveTemplateDialog}
          onClose={onCloseSaveTemplateDialog}
          onSuccess={() => {
            alert(t('templateSaved'));
          }}
        />
      )}

      {planFile && (
        <PlanApprovalModal
          isOpen={showPlanApprovalModal}
          onClose={onClosePlanApprovalModal}
          taskId={taskId}
          planFile={planFile}
          onApprovalComplete={onApprovalComplete}
        />
      )}
    </>
  );
}
