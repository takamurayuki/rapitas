/**
 * task.types
 *
 * Type definitions for tasks, time tracking, comments, task templates, and weekly reports.
 * Priority/status enums and display constants are co-located here as they are intrinsic to tasks.
 */

import type { Theme, Project, Milestone } from './project.types';
import type { ExamGoal, TaskLabel } from './learning.types';
import type { WorkflowStatus, WorkflowMode } from './workflow.types';
import type { DeveloperModeConfig, TaskAnalysisConfig, AgentExecutionConfig } from './agent.types';
import type { Priority, Status } from './common.types';

export type { Priority, Status } from './common.types';

export const priorityColors = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-300',
};

export const priorityLabels = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '緊急',
};

export type TimeEntry = {
  id: number;
  taskId: number;
  duration: number;
  breakDuration?: number | null;
  note?: string | null;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkedCommentSummary = {
  id: number;
  content: string;
  taskId: number;
  createdAt: string;
};

export type CommentLink = {
  id: number;
  fromCommentId: number;
  toCommentId: number;
  label?: string | null;
  fromComment?: LinkedCommentSummary;
  toComment?: LinkedCommentSummary;
  createdAt: string;
};

export type Comment = {
  id: number;
  taskId: number;
  content: string;
  parentId?: number | null;
  replies?: Comment[];
  // Link relations
  linksFrom?: CommentLink[];
  linksTo?: CommentLink[];
  createdAt: string;
  updatedAt: string;
};

export type CommentSearchResult = {
  id: number;
  content: string;
  taskId: number;
  createdAt: string;
  task?: {
    id: number;
    title: string;
  };
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: Status;
  priority: Priority;
  labels?: string[];
  taskLabels?: TaskLabel[];
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  subject?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentId?: number | null;
  parent?: Task;
  subtasks?: Task[];
  themeId?: number | null;
  theme?: Theme | null;
  projectId?: number | null;
  project?: Project | null;
  milestoneId?: number | null;
  milestone?: Milestone | null;
  examGoalId?: number | null;
  examGoal?: ExamGoal | null;
  timeEntries?: TimeEntry[];
  comments?: Comment[];
  // Task settings
  isDeveloperMode?: boolean;
  isAiTaskAnalysis?: boolean;
  agentGenerated?: boolean;
  agentExecutable?: boolean;
  executionInstructions?: string | null;
  developerModeConfig?: DeveloperModeConfig | null;
  taskAnalysisConfig?: TaskAnalysisConfig | null;
  agentExecutionConfig?: AgentExecutionConfig | null;
  workflowStatus?: WorkflowStatus | null;
  workflowMode?: WorkflowMode | null;
  complexityScore?: number | null;
  workflowModeOverride?: boolean | null;
  autoApprovePlan?: boolean;
  // Recurring task fields
  isRecurring?: boolean;
  recurrenceRule?: string | null;
  recurrenceEndAt?: string | null;
  recurrenceTime?: string | null;
  recurrenceCount?: number;
  lastGeneratedAt?: string | null;
  inheritWorkflowFiles?: boolean;
  sourceTaskId?: number | null;
  sourceTask?: Task | null;
  generatedTasks?: Task[];
  nextOccurrence?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskTemplateData = {
  title?: string;
  description?: string;
  estimatedHours?: number;
  priority?: Priority;
  labels?: string[];
  subtasks?: Array<{
    title: string;
    description?: string;
    estimatedHours?: number;
  }>;
  [key: string]: unknown;
};

export type TaskTemplate = {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  templateData: TaskTemplateData;
  isPublic: boolean;
  useCount: number;
  themeId?: number | null;
  theme?: {
    id: number;
    name: string;
    color: string;
    icon?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type WeeklyReport = {
  period: {
    start: string;
    end: string;
  };
  summary: {
    tasksCompleted: number;
    studyHours: number;
    tasksChange: number;
    hoursChange: number;
  };
  dailyData: {
    date: string;
    tasks: number;
    hours: number;
  }[];
  subjectBreakdown: {
    subject: string | null;
    count: number;
  }[];
};

// Gantt Chart Types
export type GanttTask = {
  id: number;
  title: string;
  status: string;
  dueDate?: string | null;
  estimatedHours?: number | null;
  theme?: {
    id: number;
    name: string;
    color: string;
    category?: {
      id: number;
      name: string;
    } | null;
  } | null;
};

export type GanttBarData = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  taskId: number;
  title: string;
  status: string;
};

export type GanttData = {
  tasks: GanttTask[];
  metadata: {
    totalTasks: number;
    dateRange: {
      from: string | null;
      to: string | null;
    };
    filters: {
      themeId: number | null;
      categoryId: number | null;
    };
  };
};
