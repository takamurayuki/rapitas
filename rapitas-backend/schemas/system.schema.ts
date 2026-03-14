/**
 * System Settings Validation Schemas
 *
 * Defines Elysia validation schemas for system settings API endpoints.
 */
import { t } from 'elysia';

export const systemSchemas = {
  userSettings: t.Object({
    developerModeDefault: t.Optional(t.Boolean()),
    aiTaskAnalysisDefault: t.Optional(t.Boolean()),
    autoResumeInterruptedTasks: t.Optional(t.Boolean()),
    autoExecuteAfterCreate: t.Optional(t.Boolean()),
    autoGenerateTitle: t.Optional(t.Boolean()),
    autoGenerateTitleDelay: t.Optional(t.Number()),
    autoCreateAfterTitleGeneration: t.Optional(t.Boolean()),
    autoApprovePlan: t.Optional(t.Boolean()),
    autoComplexityAnalysis: t.Optional(t.Boolean()),
    defaultAiProvider: t.Optional(t.String()),
    defaultCategoryId: t.Optional(t.Number()),
    activeMode: t.Optional(t.String()),
  }),

  aiProviderConfig: t.Object({
    apiKey: t.String({ minLength: 1 }),
    provider: t.Optional(t.String()),
  }),

  modelConfig: t.Object({
    model: t.String({ minLength: 1 }),
    provider: t.Optional(t.String()),
  }),

  urlMetadata: t.Object({
    url: t.String({ format: 'uri' }),
  }),

  directoryPath: t.Object({
    path: t.String({ minLength: 1 }),
  }),

  createDirectory: t.Object({
    path: t.String({ minLength: 1 }),
    name: t.String({ minLength: 1 }),
  }),

  createFile: t.Object({
    name: t.String({ minLength: 1 }),
  }),

  deletePath: t.Object({
    path: t.String({ minLength: 1 }),
  }),

  screenshotConfig: t.Object({
    workingDirectory: t.String({ minLength: 1 }),
  }),

  notificationQuery: t.Object({
    unreadOnly: t.Optional(t.String({ pattern: '^(true|false)$' })),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' })),
  }),

  debugLog: t.Object({
    content: t.String({ minLength: 1 }),
    type: t.Optional(t.String()),
    options: t.Optional(t.Record(t.String(), t.Any())),
  }),

  debugLogUrl: t.Object({
    url: t.String({ format: 'uri' }),
    type: t.Optional(t.String()),
    options: t.Optional(t.Record(t.String(), t.Any())),
  }),
};

export const systemQuerySchemas = {
  directoryList: t.Object({
    path: t.String({ minLength: 1 }),
  }),

  notifications: t.Object({
    unreadOnly: t.Optional(t.String({ pattern: '^(true|false)$' })),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' })),
  }),
};
