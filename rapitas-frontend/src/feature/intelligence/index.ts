export { SuggestedTasksWidget } from './components/SuggestedTasksWidget';
export { ProductivityHeatmap } from './components/ProductivityHeatmap';
export { RelatedKnowledgePanel } from './components/RelatedKnowledgePanel';
export { WorkflowLearningPanel } from './components/WorkflowLearningPanel';

export {
  useSuggestedTasks,
  useProductivityHeatmap,
  useKnowledgeReminders,
  useRelatedKnowledge,
} from './hooks/useIntelligence';

export type {
  TaskSuggestion,
  ProductivityPattern,
  SuggestedTasksResponse,
  HeatmapCell,
  HeatmapCellTask,
  HeatmapResponse,
  ReminderSummary,
  RelatedKnowledge,
} from './hooks/useIntelligence';
