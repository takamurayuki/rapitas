/**
 * GitHub Integration Validation Schemas
 *
 * Defines Elysia validation schemas for GitHub-related API endpoints.
 */
import { t } from 'elysia';

export const githubSchemas = {
  integrationUpdate: t.Object({
    syncIssues: t.Optional(t.Boolean()),
    syncPullRequests: t.Optional(t.Boolean()),
    autoLinkTasks: t.Optional(t.Boolean()),
    isActive: t.Optional(t.Boolean()),
  }),

  createComment: t.Object({
    body: t.String({ minLength: 1 }),
    path: t.Optional(t.String()),
    line: t.Optional(t.Number()),
  }),

  createReview: t.Object({
    body: t.String({ minLength: 1 }),
  }),

  createIssue: t.Object({
    title: t.String({ minLength: 1 }),
    body: t.Optional(t.String()),
    labels: t.Optional(t.Array(t.String())),
    assignees: t.Optional(t.Array(t.String())),
  }),

  linkTask: t.Object({
    projectId: t.Optional(t.Number()),
    themeId: t.Optional(t.Number()),
    priority: t.Optional(t.String()),
  }),

  webhookConfig: t.Object({
    events: t.Array(t.String()),
    active: t.Optional(t.Boolean()),
    config: t.Optional(t.Record(t.String(), t.Any())),
  }),
};

export const githubParamSchemas = {
  integrationId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
  }),

  prId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
    prId: t.String({ pattern: '^[0-9]+$' }),
  }),

  issueId: t.Object({
    id: t.String({ pattern: '^[0-9]+$' }),
    issueId: t.String({ pattern: '^[0-9]+$' }),
  }),
};

export const githubQuerySchemas = {
  prIssueList: t.Object({
    state: t.Optional(t.String()),
    fromGitHub: t.Optional(t.String({ pattern: '^(true|false)$' })),
  }),

  search: t.Object({
    q: t.Optional(t.String()),
    type: t.Optional(t.String()),
    limit: t.Optional(t.String({ pattern: '^[0-9]+$' })),
  }),
};
