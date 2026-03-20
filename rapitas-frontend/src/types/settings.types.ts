/**
 * settings.types
 *
 * Type definitions for user settings, API provider configuration, and active mode selection.
 */

export type ApiProvider = 'claude' | 'chatgpt' | 'gemini' | 'ollama';

export type ApiKeyStatus = {
  configured: boolean;
  maskedKey: string | null;
};

export type ActiveMode = 'development' | 'learning' | 'both';

export type UserSettings = {
  id: number;
  aiTaskAnalysisDefault: boolean;
  autoResumeInterruptedTasks: boolean;
  autoExecuteAfterCreate: boolean;
  autoGenerateTitle: boolean;
  autoGenerateTitleDelay: number;
  autoCreateAfterTitleGeneration: boolean;
  autoFetchTaskSuggestions: boolean;
  autoApprovePlan: boolean;
  autoApproveSubtaskPlan: boolean;
  autoComplexityAnalysis: boolean;
  defaultCategoryId?: number | null;
  activeMode: ActiveMode;
  claudeApiKeyConfigured?: boolean;
  claudeApiKeyMasked?: string | null;
  chatgptApiKeyConfigured?: boolean;
  chatgptApiKeyMasked?: string | null;
  geminiApiKeyConfigured?: boolean;
  geminiApiKeyMasked?: string | null;
  claudeDefaultModel?: string | null;
  chatgptDefaultModel?: string | null;
  geminiDefaultModel?: string | null;
  defaultAiProvider?: ApiProvider | null;
  ollamaUrl?: string | null;
  ollamaDefaultModel?: string | null;
  titleGenerationProvider?: string | null;
  createdAt: string;
  updatedAt: string;
};
