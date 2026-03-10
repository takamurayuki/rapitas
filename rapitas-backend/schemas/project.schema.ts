/**
 * Project Validation Schemas
 */
import { t } from 'elysia';

export const projectSchema = {
  create: t.Object({
    name: t.String({ minLength: 1 }),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
  }),

  update: t.Object({
    name: t.Optional(t.String()),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
  }),
};
