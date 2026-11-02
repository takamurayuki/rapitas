'use client';
// TaskDetailViewBody
import type { Task, Resource, Comment, WorkflowStatus, Priority } from '@/types';
import CompactTaskDetailCard from '@/feature/tasks/components/detail/CompactTaskDetailCard';
import { API_BASE_URL } from '@/utils/api';
import TaskAISection, { type TaskAISectionProps } from './TaskAISection';
import TaskWorkflowSection from './TaskWorkflowSection';
import TaskPreviewSection from './TaskPreviewSection';
import SubtaskSection from './SubtaskSection';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/status/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useTranslations } from 'next-intl';

const API_BASE = API_BASE_URL;

/** Subset of useTaskActions return values consumed by the view body. */
interface TaskActionsViewSlice {
  updateStatus: (id: number, status: string) => Promise<void>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  editingSubtaskId: number | null;
  editingSubtaskTitle: string;
  editingSubtaskDescription: string;
  editingSubtaskPriority: Priority;
  editingSubtaskEstimatedHours: string;
  editingSubtaskActualHours: string;
  toggleSubtaskSelectionMode: () => void;
  selectAllSubtasks: () => void;
  deselectAllSubtasks: () => void;
  toggleSubtaskSelection: (id: number) => void;
  handleDeleteSelectedSubtasks: () => Promise<void>;
  startEditingSubtask: (subtask: NonNullable<Task['subtasks']>[number]) => void;
  setEditingSubtaskTitle: (v: string) => void;
  setEditingSubtaskDescription: (v: string) => void;
  setEditingSubtaskPriority: (v: Priority) => void;
  setEditingSubtaskEstimatedHours: (v: string) => void;
  setEditingSubtaskActualHours: (v: string) => void;
  saveSubtaskEdit: () => void;
  cancelEditingSubtask: () => void;
  newSubtaskTitle: string;
  newSubtaskDescription: string;
  newSubtaskPriority: Priority;
  newSubtaskEstimatedHours: string;
  newSubtaskActualHours: string;
  setNewSubtaskTitle: (v: string) => void;
  setNewSubtaskDescription: (v: string) => void;
  setNewSubtaskPriority: (v: Priority) => void;
  setNewSubtaskEstimatedHours: (v: string) => void;
  setNewSubtaskActualHours: (v: string) => void;
  addSubtask: () => Promise<void>;
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
  onTaskUpdated,
  setTask,
  isParallelExecutionRunning,
  getSubtaskStatus,
}: TaskDetailViewBodyProps) {
  const tDev = useTranslations('devMode');
  useExecutionStateStore((s) => s.loadingTaskIds.has(taskId));

  return (
    <>
      <div id="td-info" className="mb-6 scroll-mt-16">
        <CompactTaskDetailCard
          task={task}
          onStatusUpdate={taskActions.updateStatus}
          onTaskUpdated={refreshTask}
          resources={resources}
          onResourcesChange={async () => {
            const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}/resources`);
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

      {/* The AI assistant chat used to sit here, between the detail card and
          the execution card. It is ラピ's now — she is already the thing in
          this app you talk to, and a second conversational panel on the page
          cost a card's worth of height on every task whether or not anyone
          spoke to it. The same component runs in her bubble, against the same
          /copilot endpoints, so nothing it could do was lost. */}

      {/* Agent Execution — split out from the AI assistant chat into its own
          always-visible card. Nesting it inside the chat panel made it
          compete for space with an unrelated conversational feature, which
          both mismatched this card's height against its siblings and hid
          the run controls behind an accordion; standing alone fixes both. */}
      {/* Hidden entirely for themes without a workingDirectory (operator
          request 2026-09-02): agents cannot run there, so the section only
          ever showed setup guidance — noise on non-development tasks. */}
      {showAIPanel && !!task.theme?.workingDirectory && (
        <div id="td-execution" className="scroll-mt-16">
          {/* mb-6: the section card carries its own bottom margin, so the
              fallback needs one too or it sits flush against the workflow card. */}
          <ErrorBoundary section={tDev('executionSection.title')} className="mb-6">
            <TaskAISection
              task={task}
              taskId={taskId}
              resolvedTaskId={resolvedTaskId}
              {...aiSectionProps}
            />
          </ErrorBoundary>
        </div>
      )}

      {task.theme?.isDevelopment === true && (
        <div id="td-workflow" className="scroll-mt-16">
          <TaskWorkflowSection
            task={task}
            taskId={taskId}
            currentWorkflowStatus={currentWorkflowStatus}
            setCurrentWorkflowStatus={setCurrentWorkflowStatus}
            isWorkflowLoading={isWorkflowLoading}
            workflowError={workflowError}
            onPlanApprovalRequest={onPlanApprovalRequest}
            onTaskUpdated={onTaskUpdated}
            setTask={setTask}
          />
        </div>
      )}

      {task.theme?.isDevelopment === true && (
        <div id="td-preview" className="scroll-mt-16">
          <TaskPreviewSection taskId={taskId} />
        </div>
      )}

      <div id="td-subtasks" className="scroll-mt-16">
        <SubtaskSection
          subtasks={task.subtasks || []}
          themeName={task.theme?.name}
          categoryName={task.theme?.category?.name}
          isSubtaskSelectionMode={taskActions.isSubtaskSelectionMode}
          selectedSubtaskIds={taskActions.selectedSubtaskIds}
          editingSubtaskId={taskActions.editingSubtaskId}
          editingSubtaskTitle={taskActions.editingSubtaskTitle}
          editingSubtaskDescription={taskActions.editingSubtaskDescription}
          editingSubtaskPriority={taskActions.editingSubtaskPriority}
          editingSubtaskEstimatedHours={taskActions.editingSubtaskEstimatedHours}
          editingSubtaskActualHours={taskActions.editingSubtaskActualHours}
          isParallelExecutionRunning={isParallelExecutionRunning}
          getSubtaskStatus={getSubtaskStatus}
          onToggleSelectionMode={taskActions.toggleSubtaskSelectionMode}
          onSelectAll={taskActions.selectAllSubtasks}
          onDeselectAll={taskActions.deselectAllSubtasks}
          onToggleSubtaskSelection={taskActions.toggleSubtaskSelection}
          onDeleteSelected={taskActions.handleDeleteSelectedSubtasks}
          onStartEditingSubtask={taskActions.startEditingSubtask}
          onSetEditingSubtaskTitle={taskActions.setEditingSubtaskTitle}
          onSetEditingSubtaskDescription={taskActions.setEditingSubtaskDescription}
          onSetEditingSubtaskPriority={taskActions.setEditingSubtaskPriority}
          onSetEditingSubtaskEstimatedHours={taskActions.setEditingSubtaskEstimatedHours}
          onSetEditingSubtaskActualHours={taskActions.setEditingSubtaskActualHours}
          onSaveSubtaskEdit={taskActions.saveSubtaskEdit}
          onCancelEditingSubtask={taskActions.cancelEditingSubtask}
          onUpdateStatus={taskActions.updateStatus}
          newSubtaskTitle={taskActions.newSubtaskTitle}
          newSubtaskDescription={taskActions.newSubtaskDescription}
          newSubtaskPriority={taskActions.newSubtaskPriority}
          newSubtaskEstimatedHours={taskActions.newSubtaskEstimatedHours}
          newSubtaskActualHours={taskActions.newSubtaskActualHours}
          onSetNewSubtaskTitle={taskActions.setNewSubtaskTitle}
          onSetNewSubtaskDescription={taskActions.setNewSubtaskDescription}
          onSetNewSubtaskPriority={taskActions.setNewSubtaskPriority}
          onSetNewSubtaskEstimatedHours={taskActions.setNewSubtaskEstimatedHours}
          onSetNewSubtaskActualHours={taskActions.setNewSubtaskActualHours}
          onAddSubtask={taskActions.addSubtask}
        />
      </div>
    </>
  );
}
