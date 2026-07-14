/**
 * learning.types
 *
 * Type definitions for learning-related domain entities: labels, exam goals, study streaks,
 * learning goals, habits, and resources.
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

export type ExamGoal = {
  id: number;
  name: string;
  description?: string | null;
  examDate: string;
  targetScore?: string | null;
  color: string;
  icon?: string | null;
  isCompleted: boolean;
  actualScore?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type StudyStreak = {
  id: number;
  date: string;
  studyMinutes: number;
  tasksCompleted: number;
  createdAt: string;
  updatedAt: string;
};

export type LearningGoalSubtask = {
  title: string;
  description?: string;
  estimatedHours?: number;
};

export type LearningGoalTask = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority?: string;
  subtasks?: LearningGoalSubtask[];
};

export type LearningGoalPhase = {
  name: string;
  days: number;
  description?: string;
  tasks: LearningGoalTask[];
};

export type LearningGoalResource = {
  title: string;
  type: string;
  description: string;
  url?: string;
};

export type GeneratedLearningPlan = {
  themeName?: string;
  themeDescription?: string;
  phases: LearningGoalPhase[];
  recommendedResources?: LearningGoalResource[];
  tips?: string[];
};

export type LearningGoal = {
  id: number;
  title: string;
  description?: string | null;
  currentLevel?: string | null;
  targetLevel?: string | null;
  deadline?: string | null;
  dailyHours: number;
  categoryId?: number | null;
  themeId?: number | null;
  status: 'active' | 'completed' | 'archived';
  generatedPlan?: string | null;
  isApplied: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Habit = {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  color: string;
  frequency: string;
  targetCount: number;
  isActive: boolean;
  logs?: HabitLog[];
  _count?: { logs: number };
  createdAt: string;
  updatedAt: string;
};

export type HabitLog = {
  id: number;
  habitId: number;
  date: string;
  count: number;
  note?: string | null;
  createdAt: string;
};

export type Resource = {
  id: number;
  taskId?: number | null;
  title: string;
  url?: string | null;
  type: string;
  description?: string | null;
  // File upload fields
  filePath?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  updatedAt: string;
};
