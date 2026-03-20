/**
 * Task Service
 *
 * Re-exports all public task business logic from sub-modules for backward compatibility.
 * Import from specific sub-modules (task-mutations, task-suggestions, task-cleanup)
 * when adding new code to keep files under the 300-line limit.
 */

// Mutations: create and update
export {
  TASK_FULL_INCLUDE,
  createTask,
  updateTask,
  type CreateTaskInput,
  type UpdateTaskInput,
} from './task-mutations';

// Suggestions: frequency-based and AI-generated
export { getFrequencyBasedSuggestions, generateAISuggestions } from './task-suggestions';

// Cleanup: duplicate subtask removal
export { cleanupDuplicateSubtasks, cleanupAllDuplicateSubtasks } from './task-cleanup';
