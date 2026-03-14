/**
 * Category Validation Schemas
 */
import { t } from 'elysia';

export const categorySchema = {
  create: t.Object({
    name: t.String({ minLength: 1 }),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    mode: t.Optional(t.String()), // "development", "learning", "both"
    sortOrder: t.Optional(t.Number()),
  }),

  update: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    mode: t.Optional(t.String()), // "development", "learning", "both"
    sortOrder: t.Optional(t.Number()),
  }),
};
