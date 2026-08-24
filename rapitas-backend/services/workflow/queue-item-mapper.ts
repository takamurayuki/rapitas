/**
 * queue-item-mapper
 *
 * Row-to-QueueItem mapping for WorkflowQueueService. Extracted from
 * workflow-queue.ts (file-size split) as a standalone function so
 * queue-dequeue-candidate.ts can share it without importing the service class.
 */
import type { QueueItem, WorkflowQueueItemRow } from './workflow-queue.types';

/**
 * Convert a raw WorkflowQueueItem DB row into the public QueueItem shape.
 *
 * @param item - Raw DB row. / DB行
 * @returns Mapped QueueItem (dependencies parsed from JSON). / 変換後のQueueItem
 */
export function mapToQueueItem(item: WorkflowQueueItemRow): QueueItem {
  return {
    id: item.id,
    taskId: item.taskId,
    orchestraSessionId: item.orchestraSessionId,
    priority: item.priority,
    status: item.status,
    currentPhase: item.currentPhase,
    dependencies: JSON.parse(item.dependencies || '[]'),
    retryCount: item.retryCount,
    maxRetries: item.maxRetries,
    errorMessage: item.errorMessage,
    queuedAt: item.queuedAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
  };
}
