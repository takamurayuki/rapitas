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

export type Priority = "low" | "medium" | "high" | "urgent";

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: Priority;
  labels?: string[];
  estimatedHours?: number | null;
  actualHours?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentId?: number | null;
  parent?: Task;
  subtasks?: Task[];
  projectId?: number | null;
  project?: Project | null;
  milestoneId?: number | null;
  milestone?: Milestone | null;
  timeEntries?: TimeEntry[];
  comments?: Comment[];
  createdAt: string;
  updatedAt: string;
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

export type Comment = {
  id: number;
  taskId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityLog = {
  id: number;
  taskId?: number | null;
  projectId?: number | null;
  action: string;
  changes?: any;
  metadata?: any;
  createdAt: string;
};

export const priorityColors = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-300",
};

export const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "緊急",
};
