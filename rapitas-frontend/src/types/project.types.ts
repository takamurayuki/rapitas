/**
 * project.types
 *
 * Type definitions for categories, themes, projects, and milestones.
 * Does not include task-level types; see task.types.ts for those.
 */

export type CategoryMode = 'development' | 'learning' | 'both';

export type Category = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  mode: CategoryMode;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  themes?: Theme[];
  _count?: {
    themes: number;
  };
};

export type Theme = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  // Development project settings
  isDevelopment?: boolean;
  repositoryUrl?: string | null;
  workingDirectory?: string | null;
  defaultBranch?: string | null;
  sortOrder: number;
  categoryId?: number | null;
  category?: Category | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
    milestones: number;
  };
};

export type Milestone = {
  id: number;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  projectId: number;
  project?: Project;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};
