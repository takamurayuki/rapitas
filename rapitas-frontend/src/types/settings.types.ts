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
  /** Per-theme cap on auto-created backlog tasks when auto-run runs dry (0 = disabled). */
  autoCreateFromBacklogLimit?: number;
  /** Dev: restart the backend when auto-run runs dry to apply committed fixes. */
  restartOnAutoRunDry?: boolean;
  /** Max verify->implement self-repair cycles before a task is blocked (0 = off). */
  verifyRepairLimit?: number;
  autoCommitDefault?: boolean;
  autoCreatePRDefault?: boolean;
  autoMergePRDefault?: boolean;
  mergeCommitThresholdDefault?: number;
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
  /**
   * When true, CLI agents are spawned with their permission-bypass flags
   * (`--dangerously-skip-permissions` for Claude Code, `--yolo` for Codex /
   * Gemini) so they never stop mid-execution to ask the user. Default true.
   */
  skipAgentPermissionPrompts?: boolean;
  /**
   * Global off-switch for the multi-phase workflow (research/plan/verify as
   * separately-saved artifacts + phase-critic gate). When true, new task
   * executions skip straight to a single direct-implementation pass — lint/
   * test verification, adversarial diff review, and the completion gate still
   * apply. See Task.workflowDisabled for the per-task equivalent.
   */
  workflowDisabledGlobally?: boolean;
  createdAt: string;
  updatedAt: string;
};
