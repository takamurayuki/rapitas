/**
 * spec
 *
 * A task's spec fields and the rule for which of them a development-project
 * task requires (#1555), shared by the new-task form and the task detail.
 */
export { TaskSpecFields, type TaskSpecFieldsProps, type TaskSpecValues } from './TaskSpecFields';
export {
  DELIVERABLE_OPTIONS,
  specErrors,
  toLines,
  type DeliverableOption,
  type SpecErrors,
  type SpecTextValues,
} from './task-spec-validation';
export { default as TaskSpecEditSection } from './TaskSpecEditSection';
export { useTaskSpecEditor } from './useTaskSpecEditor';
