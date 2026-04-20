'use client';
// TaskDetailContent
import { useRef, useState, useEffect } from 'react';
import type {
  Task,
  Resource,
  Comment,
  WorkflowStatus,
  DeveloperModeConfig,
} from '@/types';
import TaskDetailHeader from './TaskDetailHeader';
import TaskDetailViewBody, {
  type TaskDetailViewBodyProps,
} from './TaskDetailViewBody';
import TaskEditForm from './TaskEditForm';
import TaskDetailModals from './TaskDetailModals';
import { CopilotChatPanel } from '@/components/copilot';
import type { WorkflowFile } from '@/types';
import type { Priority } from '@/types';

/** Mirrors the subset of useTaskActions consumed by editing controls. */
interface TaskEditSlice {
  isEditing: boolean;
  startEditing: () => void;
  saveTask: () => Promise<void>;
  cancelEditing: () => void;
  duplicateTask: () => Promise<void>;
  deleteTask: () => Promise<void>;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editStatus: string;
  setEditStatus: (v: string) => void;
  editDescription: string;
  setEditDescription: (v: string) => void;
  editLabelIds: number[];
  setEditLabelIds: (v: number[]) => void;
  editPriority: Priority;
  setEditPriority: (v: Priority) => void;
  editEstimatedHours: string;
  setEditEstimatedHours: (v: string) => void;
}

export interface TaskDetailContentProps {
  task: Task;
  taskId: number;
  resolvedTaskId: string;
  showSkeleton: boolean;
  isPageMode: boolean;
  isThisTaskTimer: boolean;
  pomodoroState: { isTimerRunning: boolean; taskId?: number | null };
  showPomodoroModal: boolean;
  setShowPomodoroModal: (v: boolean) => void;
  showDevModeConfig: boolean;
  setShowDevModeConfig: (v: boolean) => void;
  showSaveTemplateDialog: boolean;
  setShowSaveTemplateDialog: (v: boolean) => void;
  showPlanApprovalModal: boolean;
  onClosePlanApprovalModal: () => void;
  devModeConfig: DeveloperModeConfig | null;
  updateDevModeConfig: (
    updates: Partial<DeveloperModeConfig>,
  ) => Promise<DeveloperModeConfig | null>;
  agentConfigId: number | null;
  setAgentConfigId: (id: number | null) => void;
  planFile: WorkflowFile | null;
  onApprovalComplete: (approved: boolean, newStatus?: string) => void;
  onBack: () => void;
  taskActions: TaskEditSlice & TaskDetailViewBodyProps['taskActions'];
  viewBodyProps: Omit<
    TaskDetailViewBodyProps,
    'task' | 'taskId' | 'resolvedTaskId' | 'taskActions'
  >;
}

/**
 * Scrollable task detail page shell with header, body, and modals.
 *
 * @param props - All display state and action callbacks.
 */
export default function TaskDetailContent({
  task,
  taskId,
  resolvedTaskId,
  showSkeleton,
  isPageMode,
  isThisTaskTimer,
  pomodoroState,
  showPomodoroModal,
  setShowPomodoroModal,
  showDevModeConfig,
  setShowDevModeConfig,
  showSaveTemplateDialog,
  setShowSaveTemplateDialog,
  showPlanApprovalModal,
  onClosePlanApprovalModal,
  devModeConfig,
  updateDevModeConfig,
  agentConfigId,
  setAgentConfigId,
  planFile,
  onApprovalComplete,
  onBack,
  taskActions,
  viewBodyProps,
}: TaskDetailContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contentReady, setContentReady] = useState(false);
  const initialScrollDoneRef = useRef(false);

  useEffect(() => {
    if (
      !showSkeleton &&
      containerRef.current &&
      !initialScrollDoneRef.current
    ) {
      initialScrollDoneRef.current = true;
      containerRef.current.scrollTop = 0;
      setContentReady(false);
      requestAnimationFrame(() => setContentReady(true));
    }
  }, [showSkeleton]);

  return (
    <div
      ref={containerRef}
      className={`h-[calc(100vh-5rem)] bg-background scrollbar-thin transition-opacity duration-200 ${
        contentReady ? 'overflow-auto opacity-100' : 'overflow-hidden opacity-0'
      }`}
    >
      {/* Header spans full width */}
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-4">
        <TaskDetailHeader
          task={task}
          isEditing={taskActions.isEditing}
          isPageMode={isPageMode}
          isThisTaskTimer={isThisTaskTimer}
          pomodoroState={pomodoroState}
          onBack={onBack}
          onStartEditing={taskActions.startEditing}
          onSaveTask={taskActions.saveTask}
          onCancelEditing={taskActions.cancelEditing}
          onDuplicateTask={taskActions.duplicateTask}
          onDeleteTask={taskActions.deleteTask}
          onOpenSaveTemplate={() => setShowSaveTemplateDialog(true)}
          onOpenPomodoro={() => setShowPomodoroModal(true)}
        />
      </div>

      {/* Two-column layout: task content + copilot sidebar */}
      <div className="max-w-7xl mx-auto px-4 pb-8">
        <div className="flex gap-6">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            {taskActions.isEditing ? (
              <TaskEditForm
                editTitle={taskActions.editTitle}
                setEditTitle={taskActions.setEditTitle}
                editStatus={taskActions.editStatus}
                setEditStatus={taskActions.setEditStatus}
                editDescription={taskActions.editDescription}
                setEditDescription={taskActions.setEditDescription}
                editLabelIds={taskActions.editLabelIds}
                setEditLabelIds={taskActions.setEditLabelIds}
                editPriority={taskActions.editPriority}
                setEditPriority={taskActions.setEditPriority}
                editEstimatedHours={taskActions.editEstimatedHours}
                setEditEstimatedHours={taskActions.setEditEstimatedHours}
              />
            ) : (
              <TaskDetailViewBody
                task={task}
                taskId={taskId}
                resolvedTaskId={resolvedTaskId}
                taskActions={taskActions}
                {...viewBodyProps}
              />
            )}
          </div>

          {/* Copilot sidebar — sticky on scroll, hidden on small screens */}
          <div className="hidden lg:block w-80 xl:w-96 shrink-0">
            <div className="sticky top-20">
              <CopilotChatPanel
                taskId={taskId}
                taskTitle={task.title}
                taskStatus={task.status}
                taskDescription={task.description}
              />
            </div>
          </div>
        </div>
      </div>

      <TaskDetailModals
        task={task}
        taskId={taskId}
        showPomodoroModal={showPomodoroModal}
        onClosePomodoroModal={() => setShowPomodoroModal(false)}
        showDevModeConfig={showDevModeConfig}
        onCloseDevModeConfig={() => setShowDevModeConfig(false)}
        devModeConfig={devModeConfig}
        updateDevModeConfig={updateDevModeConfig}
        selectedAgentConfigId={agentConfigId}
        onAgentConfigChange={setAgentConfigId}
        showSaveTemplateDialog={showSaveTemplateDialog}
        onCloseSaveTemplateDialog={() => setShowSaveTemplateDialog(false)}
        showPlanApprovalModal={showPlanApprovalModal}
        onClosePlanApprovalModal={onClosePlanApprovalModal}
        planFile={planFile}
        onApprovalComplete={onApprovalComplete}
      />
    </div>
  );
}
