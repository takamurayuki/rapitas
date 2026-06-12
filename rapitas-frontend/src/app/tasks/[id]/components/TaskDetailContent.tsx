'use client';
// TaskDetailContent
import { useRef, useState, useEffect } from 'react';
import type { Task, Resource, Comment, WorkflowStatus, DeveloperModeConfig } from '@/types';
import TaskDetailViewBody, { type TaskDetailViewBodyProps } from './TaskDetailViewBody';
import TaskDetailModals from './TaskDetailModals';
import { TaskDetailQuickNav, type QuickNavSection } from './TaskDetailQuickNav';
import { Info, Bot, GitBranch, ListTodo } from 'lucide-react';
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
    if (!showSkeleton && containerRef.current && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      containerRef.current.scrollTop = 0;
      setContentReady(false);
      requestAnimationFrame(() => setContentReady(true));
    }
  }, [showSkeleton]);

  // Quick-jump targets — must match the section ids in TaskDetailViewBody.
  const quickNavSections: QuickNavSection[] = [
    { id: 'td-info', label: '詳細', icon: Info },
    { id: 'td-ai', label: 'AI', icon: Bot },
    ...(task.theme?.isDevelopment === true
      ? [{ id: 'td-workflow', label: 'ワークフロー', icon: GitBranch }]
      : []),
    { id: 'td-subtasks', label: 'サブタスク', icon: ListTodo },
  ];

  return (
    <div
      ref={containerRef}
      // In page mode this is the scroll container (fixed viewport height). In
      // panel mode the parent panel scrolls, so we drop the height/overflow here
      // to avoid a nested second scrollbar.
      // Mark as the scroll container ONLY in page mode so the quick-nav scroll-spy
      // resolves it via closest(); in panel mode the marker lives on the panel div.
      data-task-scroll-container={isPageMode ? '' : undefined}
      className={`bg-background scrollbar-thin transition-opacity duration-200 ${
        isPageMode ? 'h-[calc(100vh-5rem)]' : ''
      } ${
        contentReady
          ? `opacity-100 ${isPageMode ? 'overflow-auto' : ''}`
          : `opacity-0 ${isPageMode ? 'overflow-hidden' : ''}`
      }`}
    >
      <TaskDetailQuickNav
        sections={quickNavSections}
        task={task}
        isPageMode={isPageMode}
        isThisTaskTimer={isThisTaskTimer}
        pomodoroState={pomodoroState}
        onBack={onBack}
        onOpenPomodoro={() => setShowPomodoroModal(true)}
        onDuplicateTask={taskActions.duplicateTask}
        onDeleteTask={taskActions.deleteTask}
        onOpenSaveTemplate={() => setShowSaveTemplateDialog(true)}
      />

      {/* Main content — single column */}
      <div className="max-w-4xl mx-auto px-3 sm:px-4 md:px-6 pt-4 pb-8">
        <TaskDetailViewBody
          task={task}
          taskId={taskId}
          resolvedTaskId={resolvedTaskId}
          taskActions={taskActions}
          {...viewBodyProps}
        />
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
