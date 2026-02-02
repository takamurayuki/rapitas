/**
 * Milestone Validation Schemas
 */
import { t } from "elysia";

export const milestoneSchema = {
  create: t.Object({
    name: t.String({ minLength: 1 }),
    projectId: t.Number(),
    description: t.Optional(t.String()),
    dueDate: t.Optional(t.String()),
  }),

  update: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
    dueDate: t.Optional(t.String()),
  }),
};
