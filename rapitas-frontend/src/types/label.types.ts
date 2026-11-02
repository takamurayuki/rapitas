/**
 * label.types
 *
 * Type definitions for task labels and their join rows.
 *
 * NOTE: These used to live in learning.types.ts alongside the study-goal and
 * habit types. Labels have nothing to do with learning; they shared the file
 * only by accident, and the learning features were removed.
 */

export type Label = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  sortOrder: number;
  /** Owning category — null for global labels (2026-07 migration from per-theme). */
  categoryId?: number | null;
  /** @deprecated superseded by categoryId; kept while old rows migrate. */
  themeId?: number | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type TaskLabel = {
  id: number;
  taskId: number;
  labelId: number;
  label?: Label;
  createdAt: string;
};
