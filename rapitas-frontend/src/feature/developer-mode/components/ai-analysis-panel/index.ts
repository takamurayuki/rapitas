/**
 * ai-analysis-panel/index.ts
 *
 * Barrel export for the AIAnalysisPanel feature split.
 * Import from this file rather than from individual sub-modules.
 */

export { AIAnalysisPanel } from './AIAnalysisPanel';
export { ApiKeySetupPrompt } from './ApiKeySetupPrompt';
export { AnalysisTab } from './AnalysisTab';
export { PromptOptimizationTab } from './PromptOptimizationTab';
export { PromptsManagementTab } from './PromptsManagementTab';
export { SettingsTab } from './SettingsTab';
export { useApiKey } from './use-api-key';
export { usePromptOptimization } from './use-prompt-optimization';
export { usePromptsManagement } from './use-prompts-management';
export type {
  TabType,
  OptimizedPromptResult,
  SavedPrompt,
  PromptsData,
  PromptClarificationQuestion,
  StructuredSections,
  PromptQuality,
  SubtaskInfo,
} from './types';
