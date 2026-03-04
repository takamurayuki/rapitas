/**
 * System Settings Validation Schemas
 * システム設定関連の型定義
 */
import { t } from "elysia";

export const systemSchemas = {
  // ユーザー設定更新
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
    activeMode: t.Optional(t.String())
  }),

  // AIプロバイダー設定
  aiProviderConfig: t.Object({
    apiKey: t.String({ minLength: 1 }),
    provider: t.Optional(t.String())
  }),

  // モデル設定
  modelConfig: t.Object({
    model: t.String({ minLength: 1 }),
    provider: t.Optional(t.String())
  }),

  // URL メタデータ取得
  urlMetadata: t.Object({
    url: t.String({ format: "uri" })
  }),

  // ディレクトリ操作
  directoryPath: t.Object({
    path: t.String({ minLength: 1 })
  }),

  // ディレクトリ作成
  createDirectory: t.Object({
    path: t.String({ minLength: 1 }),
    name: t.String({ minLength: 1 })
  }),

  // ファイル作成
  createFile: t.Object({
    name: t.String({ minLength: 1 })
  }),

  // 削除操作
  deletePath: t.Object({
    path: t.String({ minLength: 1 })
  }),

  // スクリーンショット設定
  screenshotConfig: t.Object({
    workingDirectory: t.String({ minLength: 1 })
  }),

  // 通知設定
  notificationQuery: t.Object({
    unreadOnly: t.Optional(t.String({ pattern: '^(true|false)$' })),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' }))
  }),

  // デバッグログ
  debugLog: t.Object({
    content: t.String({ minLength: 1 }),
    type: t.Optional(t.String()),
    options: t.Optional(t.Record(t.String(), t.Any()))
  }),

  // デバッグログURL
  debugLogUrl: t.Object({
    url: t.String({ format: "uri" }),
    type: t.Optional(t.String()),
    options: t.Optional(t.Record(t.String(), t.Any()))
  })
};

// システム設定クエリパラメータ
export const systemQuerySchemas = {
  // ディレクトリ一覧クエリ
  directoryList: t.Object({
    path: t.String({ minLength: 1 })
  }),

  // 通知一覧クエリ
  notifications: t.Object({
    unreadOnly: t.Optional(t.String({ pattern: '^(true|false)$' })),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' }))
  })
};