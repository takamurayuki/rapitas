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
    runtimeConfigJson: t.Optional(t.String()),
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
    runtimeConfigJson: t.Optional(t.Nullable(t.String())),
    categoryId: t.Optional(t.Nullable(t.Number())),
    sortOrder: t.Optional(t.Number()),
  }),

  setupFromClaudeMd: t.Object({
    appName: t.String({ minLength: 1 }),
    claudeMd: t.String({ minLength: 1 }),
    // Optional companion docs written to docs/ alongside the agent guide.
    requirements: t.Optional(t.String()),
    design: t.Optional(t.String()),
    // Architecture decision records written to docs/adr/.
    adr: t.Optional(t.String()),
    // Project skeleton written at the root. Paths are validated by
    // scaffold-project-writer — this schema only shapes the envelope.
    scaffold: t.Optional(
      t.Array(t.Object({ path: t.String({ maxLength: 200 }), content: t.String() }), {
        maxItems: 60,
      }),
    ),
    // Repo-relative path for the agent guide (defaults to .claude/CLAUDE.md).
    agentFilePath: t.Optional(t.String()),
    basePath: t.Optional(t.String()),
    description: t.Optional(t.String()),
    // NOTE: Must be declared here or Elysia strips it from the body before the
    // handler sees it — the category picker silently had no effect without it.
    categoryId: t.Optional(t.Number()),
  }),
};
