/**
 * TaskDetailViewBody
 *
 * Renders the view-mode body of the task detail page: the compact task card,
 * AI assistant panel, workflow section, dependency graph, and subtask list.
 * Not responsible for edit mode — TaskEditForm handles that branch.
 */

'use client';
import type { Task, Resource, Comment, WorkflowStatus, Priority } from '@/types';
import CompactTaskDetailCard from '@/feature/tasks/components/CompactTaskDetailCard';
import { API_BASE_URL } from '@/utils/api';
import TaskAISection, { type TaskAISectionProps } from './TaskAISection';
import TaskWorkflowSection from './TaskWorkflowSection';
import SubtaskSection from './SubtaskSection';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/executionStateStore';

const API_BASE = API_BASE_URL;

/** Subset of useTaskActions return values consumed by the view body. */
interface TaskActionsViewSlice {
  updateStatus: (id: number, status: string) => Promise<void>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  showSubtaskDeleteConfirm: 'all' | 'selected' | null;
  setShowSubtaskDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskLabels: string;
  editingSubtaskEstimatedHours: string;
  toggleSubtaskSelectionMode: () => void;
  selectAllSubtasks: () => void;
  deselectAllSubtasks: () => void;
  toggleSubtaskSelection: (id: number) => void;
  handleDeleteAllSubtasks: () => Promise<void>;
  handleDeleteSelectedSubtasks: () => Promise<void>;
  startEditingSubtask: (subtask: NonNullable<Task['subtasks']>[number]) => void;
  setEditingSubtaskTitle: (v: string) => void;
  setEditingSubtaskDescription: (v: string) => void;
  setEditingSubtaskPriority: (v: Priority) => void;
  setEditingSubtaskLabels: (v: string) => void;
  setEditingSubtaskEstimatedHours: (v: string) => void;
  saveSubtaskEdit: () => void;
  cancelEditingSubtask: () => void;
  isAddingSubtask: boolean;
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskLabels: string;
  newSubtaskEstimatedHours: string;
  toggleAddSubtask: () => void;
  setNewSubtaskTitle: (v: string) => void;
  setNewSubtaskDescription: (v: string) => void;
  setNewSubtaskLabels: (v: string) => void;
  setNewSubtaskEstimatedHours: (v: string) => void;
  addSubtask: () => Promise<void>;
  cancelAddSubtask: () => void;
}

/** Subset of useCommentSystem return values consumed by the view body. */
interface CommentSystemSlice {
  handleAddComment: (content?: string, parentId?: number) => Promise<number | null>;
  handleUpdateComment: (id: number, content: string) => Promise<void>;
  handleDeleteComment: (id: number) => Promise<void>;
  handleCreateCommentLink: (from: number, to: number, label?: string) => Promise<void>;
  handleDeleteCommentLink: (linkId: number) => Promise<void>;
}

export interface TaskDetailViewBodyProps {
  task: Task;
  taskId: number;
  resolvedTaskId: string;
  resources: Resource[];
  setResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  setNewComment: (v: string) => void;
  commentSystem: CommentSystemSlice;
  taskActions: TaskActionsViewSlice;
  refreshTask: () => Promise<void>;

  /** Whether the AI assistant panel should be shown. */
  showAIPanel: boolean;
  aiSectionProps: Omit<TaskAISectionProps, 'task' | 'taskId' | 'resolvedTaskId'>;

  currentWorkflowStatus: WorkflowStatus | null;
  setCurrentWorkflowStatus: React.Dispatch<React.SetStateAction<WorkflowStatus | null>>;
  isWorkflowLoading: boolean;
  workflowError: string | null | undefined;
  onPlanApprovalRequest: () => void;
  onWorkflowComplete: () => Promise<void>;
  onTaskUpdated?: () => void;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;

  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (id: number) => ParallelExecutionStatus | undefined;
}

/**
 * View-mode body for the task detail page.
 *
 * @param props - All data and callbacks needed by the view sections.
 */
export default function TaskDetailViewBody({
  task,
  taskId,
  resolvedTaskId,
  resources,
  setResources,
  comments,
  newComment,
  isAddingComment,
  setNewComment,
  commentSystem,
  taskActions,
  refreshTask,
  showAIPanel,
  aiSectionProps,
  currentWorkflowStatus,
  setCurrentWorkflowStatus,
  isWorkflowLoading,
  workflowError,
  onPlanApprovalRequest,
  onWorkflowComplete,
  onTaskUpdated,
  setTask,
  isParallelExecutionRunning,
  getSubtaskStatus,
}: TaskDetailViewBodyProps) {
  const isTaskStatusLoading = useExecutionStateStore((s) => s.loadingTaskIds.has(taskId));

  return (
    <>
      <div className="mb-6">
        <CompactTaskDetailCard
          task={task}
          onStatusUpdate={taskActions.updateStatus}
          onTaskUpdated={refreshTask}
          resources={resources}
          onResourcesChange={async () => {
            const res = await fetch(
              `${API_BASE}/tasks/${resolvedTaskId}/resources`,
            );
            if (res.ok) setResources(await res.json());
          }}
          comments={comments}
          newComment={newComment}
          isAddingComment={isAddingComment}
          onNewCommentChange={setNewComment}
          onAddComment={commentSystem.handleAddComment}
          onUpdateComment={commentSystem.handleUpdateComment}
          onDeleteComment={commentSystem.handleDeleteComment}
          onCreateLink={commentSystem.handleCreateCommentLink}
          onDeleteLink={commentSystem.handleDeleteCommentLink}
        />
      </div>

      {showAIPanel && (
        isTaskStatusLoading ? (
          <div className="mb-6">
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden animate-pulse">
              <div className="px-4 py-2.5 flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-800">
                <div className="w-4 h-4 bg-zinc-200 dark:bg-zinc-700 rounded" />
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
              </div>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-200 dark:bg-zinc-700" />
                  <div className="flex-1 space-y-3">
                    <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
                    <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-64" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <TaskAISection
            task={task}
            taskId={taskId}
            resolvedTaskId={resolvedTaskId}
            {...aiSectionProps}
          />
        )
      )}

      {task.theme?.isDevelopment === true && (
        <TaskWorkflowSection
          task={task}
          taskId={taskId}
          currentWorkflowStatus={currentWorkflowStatus}
          setCurrentWorkflowStatus={setCurrentWorkflowStatus}
          isWorkflowLoading={isWorkflowLoading}
          workflowError={workflowError}
          onPlanApprovalRequest={onPlanApprovalRequest}
          onWorkflowComplete={onWorkflowComplete}
          onTaskUpdated={onTaskUpdated}
          setTask={setTask}
        />
      )}

      <SubtaskSection
        subtasks={task.subtasks || []}
        isSubtaskSelectionMode={taskActions.isSubtaskSelectionMode}
        selectedSubtaskIds={taskActions.selectedSubtaskIds}
        showSubtaskDeleteConfirm={taskActions.showSubtaskDeleteConfirm}
        editingSubtaskId={taskActions.editingSubtaskId}
        editingSubtaskTitle={taskActions.editingSubtaskTitle}
        editingSubtaskDescription={taskActions.editingSubtaskDescription}
        editingSubtaskPriority={taskActions.editingSubtaskPriority}
        editingSubtaskLabels={taskActions.editingSubtaskLabels}
        editingSubtaskEstimatedHours={taskActions.editingSubtaskEstimatedHours}
        isParallelExecutionRunning={isParallelExecutionRunning}
        getSubtaskStatus={getSubtaskStatus}
        onToggleSelectionMode={taskActions.toggleSubtaskSelectionMode}
        onSelectAll={taskActions.selectAllSubtasks}
        onDeselectAll={taskActions.deselectAllSubtasks}
        onToggleSubtaskSelection={taskActions.toggleSubtaskSelection}
        onSetDeleteConfirm={taskActions.setShowSubtaskDeleteConfirm}
        onDeleteAll={taskActions.handleDeleteAllSubtasks}
        onDeleteSelected={taskActions.handleDeleteSelectedSubtasks}
        onStartEditingSubtask={taskActions.startEditingSubtask}
        onSetEditingSubtaskTitle={taskActions.setEditingSubtaskTitle}
        onSetEditingSubtaskDescription={taskActions.setEditingSubtaskDescription}
        onSetEditingSubtaskPriority={taskActions.setEditingSubtaskPriority}
        onSetEditingSubtaskLabels={taskActions.setEditingSubtaskLabels}
        onSetEditingSubtaskEstimatedHours={taskActions.setEditingSubtaskEstimatedHours}
        onSaveSubtaskEdit={taskActions.saveSubtaskEdit}
        onCancelEditingSubtask={taskActions.cancelEditingSubtask}
        onUpdateStatus={taskActions.updateStatus}
        isAddingSubtask={taskActions.isAddingSubtask}
        newSubtaskTitle={taskActions.newSubtaskTitle}
        newSubtaskDescription={taskActions.newSubtaskDescription}
        newSubtaskLabels={taskActions.newSubtaskLabels}
        newSubtaskEstimatedHours={taskActions.newSubtaskEstimatedHours}
        onToggleAddSubtask={taskActions.toggleAddSubtask}
        onSetNewSubtaskTitle={taskActions.setNewSubtaskTitle}
        onSetNewSubtaskDescription={taskActions.setNewSubtaskDescription}
        onSetNewSubtaskLabels={taskActions.setNewSubtaskLabels}
        onSetNewSubtaskEstimatedHours={taskActions.setNewSubtaskEstimatedHours}
        onAddSubtask={taskActions.addSubtask}
        onCancelAddSubtask={taskActions.cancelAddSubtask}
      />
    </>
  );
}
