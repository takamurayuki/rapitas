/**
 * GitHub Integration Validation Schemas
 * GitHub関連の型定義
 */
import { t } from 'elysia';

export const githubSchemas = {
  // GitHub統合設定更新
  integrationUpdate: t.Object({
    syncIssues: t.Optional(t.Boolean()),
    syncPullRequests: t.Optional(t.Boolean()),
    autoLinkTasks: t.Optional(t.Boolean()),
    isActive: t.Optional(t.Boolean()),
  }),

  // GitHubコメント作成
  createComment: t.Object({
    body: t.String({ minLength: 1 }),
    path: t.Optional(t.String()),
    line: t.Optional(t.Number()),
  }),

  // GitHubレビュー
  createReview: t.Object({
    body: t.String({ minLength: 1 }),
  }),

  // GitHub Issue/PR作成
  createIssue: t.Object({
    title: t.String({ minLength: 1 }),
    body: t.Optional(t.String()),
    labels: t.Optional(t.Array(t.String())),
    assignees: t.Optional(t.Array(t.String())),
  }),

  // タスク連携
  linkTask: t.Object({
    projectId: t.Optional(t.Number()),
    themeId: t.Optional(t.Number()),
    priority: t.Optional(t.String()),
  }),

  // Webhook設定
  webhookConfig: t.Object({
    events: t.Array(t.String()),
    active: t.Optional(t.Boolean()),
    config: t.Optional(t.Record(t.String(), t.Any())),
  }),
};

// GitHub関連パラメータ
export const githubParamSchemas = {
  // GitHub統合ID
  integrationId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
  }),

  // PR ID
  prId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
    prId: t.String({ pattern: '^[0-9]+$' }),
  }),

  // Issue ID
  issueId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
    issueId: t.String({ pattern: '^[0-9]+$' }),
  }),
};

// GitHub関連クエリ
export const githubQuerySchemas = {
  // PR/Issue一覧
  prIssueList: t.Object({
    state: t.Optional(t.String()),
    fromGitHub: t.Optional(t.String({ pattern: '^(true|false)$' })),
  }),

  // 検索クエリ
  search: t.Object({
    q: t.Optional(t.String()),
    type: t.Optional(t.String()),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' })),
  }),
};
