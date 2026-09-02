'use client';
import type { Task, DeveloperModeConfig, WorkflowFile } from '@/types';
import { DeveloperModeConfigModal } from '@/feature/developer-mode/components/DeveloperModeConfig';
import SaveAsTemplateDialog from '@/feature/tasks/components/dialog/SaveAsTemplateDialog';
import PlanApprovalModal from '@/components/workflow/PlanApprovalModal';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';

interface TaskDetailModalsProps {
  task: Task;
  taskId: number;
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
  const { showToast } = useToast();
  return (
    <>
      <DeveloperModeConfigModal
        config={devModeConfig}
        isOpen={showDevModeConfig}
        onCloseAction={onCloseDevModeConfig}
        onSaveAction={updateDevModeConfig}
        selectedAgentConfigId={selectedAgentConfigId}
        onAgentConfigChangeAction={onAgentConfigChange}
        taskId={taskId}
      />

      {task && (
        <SaveAsTemplateDialog
          task={task}
          isOpen={showSaveTemplateDialog}
          onClose={onCloseSaveTemplateDialog}
          onSuccess={() => {
            showToast(t('templateSaved'), 'success');
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
