'use client';
// KanbanColumn

import {
  Droppable,
  Draggable,
  type DroppableProvided,
  type DroppableStateSnapshot,
  type DraggableProvided,
  type DraggableStateSnapshot,
} from '@hello-pangea/dnd';
import { KanbanCard } from './KanbanCard';

interface ColumnTask {
  id: number;
  title: string;
  createdAt: string;
  estimatedHours?: number | null;
  labels?: unknown;
  subtasks?: Array<{ status: string }> | null;
}

interface ExecutionClasses {
  cardClass: string;
  badgeClass: string;
  dotClass: string;
  label: string;
}

interface KanbanColumnProps {
  columnId: string;
  label: string;
  tasks: ColumnTask[];
  getExecutionClasses: (taskId: number) => ExecutionClasses | null;
  dateLocale: string;
  onOpenTask: (taskId: number) => void;
  onOpenTaskInPage: (taskId: number) => void;
  /** i18n helper for kanban namespace */
  t: (key: string, values?: Record<string, unknown>) => string;
}

/**
 * Renders a single droppable Kanban column.
 *
 * @param columnId - Droppable ID (matches task status value)
 * @param label - Human-readable column heading
 * @param tasks - Tasks to render in this column
 * @param getExecutionClasses - Returns execution-state styling for a task ID
 * @param dateLocale - Locale string for card date formatting
 * @param onOpenTask - Open task in slide panel
 * @param onOpenTaskInPage - Navigate to full task page
 * @param t - kanban translation function
 */
export function KanbanColumn({
  columnId,
  label,
  tasks,
  getExecutionClasses,
  dateLocale,
  onOpenTask,
  onOpenTaskInPage,
  t,
}: KanbanColumnProps) {
  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">{label}</h2>
        <span className="rounded-full bg-zinc-200 dark:bg-zinc-700 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {tasks.length}
        </span>
      </div>

      <Droppable droppableId={columnId}>
        {(provided: DroppableProvided, snapshot: DroppableStateSnapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 rounded-lg p-3 transition-colors ${
              snapshot.isDraggingOver
                ? 'bg-blue-50 dark:bg-blue-950'
                : 'bg-zinc-50 dark:bg-indigo-dark-900'
            } min-h-[200px]`}
          >
            <div className="space-y-2">
              {tasks.map((task, index) => (
                <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
                  {(
                    draggableProvided: DraggableProvided,
                    draggableSnapshot: DraggableStateSnapshot,
                  ) => (
                    <KanbanCard
                      task={task}
                      provided={draggableProvided}
                      snapshot={draggableSnapshot}
                      executionClasses={getExecutionClasses(task.id)}
                      dateLocale={dateLocale}
                      onOpen={onOpenTask}
                      onOpenInPage={onOpenTaskInPage}
                      t={t}
                    />
                  )}
                </Draggable>
              ))}
            </div>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
