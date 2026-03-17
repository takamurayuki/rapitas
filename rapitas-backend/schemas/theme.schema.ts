/**
 * Theme Validation Schemas
 */
import { t } from 'elysia';

export const themeSchema = {
  create: t.Object({
    name: t.String({ minLength: 1 }),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    isDevelopment: t.Optional(t.Boolean()),
    repositoryUrl: t.Optional(t.String()),
    workingDirectory: t.Optional(t.String()),
    defaultBranch: t.Optional(t.String()),
    categoryId: t.Number(),
  }),

  update: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    isDevelopment: t.Optional(t.Boolean()),
    repositoryUrl: t.Optional(t.String()),
    workingDirectory: t.Optional(t.String()),
    defaultBranch: t.Optional(t.String()),
    categoryId: t.Optional(t.Nullable(t.Number())),
    sortOrder: t.Optional(t.Number()),
  }),

  setupFromClaudeMd: t.Object({
    appName: t.String({ minLength: 1 }),
    claudeMd: t.String({ minLength: 1 }),
    basePath: t.Optional(t.String()),
    description: t.Optional(t.String()),
  }),
};
