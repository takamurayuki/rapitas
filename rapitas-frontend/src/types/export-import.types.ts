/**
 * Export/Import API type definitions
 */

/**
 * Task export filters
 */
export interface TaskExportFilters {
  includeCompleted?: boolean;
  projectId?: number;
  themeId?: number;
  categoryId?: number;
}

/**
 * JSON export response for tasks
 */
export interface TaskJsonExportResponse {
  exportedAt: string;
  totalCount: number;
  filters: TaskExportFilters;
  tasks: ExportedTask[];
}

/**
 * Exported task data structure
 */
export interface ExportedTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  labels: string;
  parentId: number | null;
  projectId: number | null;
  themeId: number | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: number; name: string } | null;
  milestone?: { id: number; name: string } | null;
  theme?: { id: number; name: string } | null;
  parent?: { id: number; title: string } | null;
  subtasks?: Array<{ id: number; title: string; status: string }>;
  timeEntries?: Array<{
    id: number;
    duration: number;
    startedAt: string;
    endedAt: string;
  }>;
}

/**
 * Full backup response
 */
export interface BackupResponse {
  exportedAt: string;
  version: string;
  counts: {
    tasks: number;
    projects: number;
    milestones: number;
    labels: number;
    categories: number;
    themes: number;
    habits: number;
    habitLogs: number;
    flashcardDecks: number;
    flashcards: number;
    examGoals: number;
    learningGoals: number;
    studyStreaks: number;
    scheduleEvents: number;
    timeEntries: number;
    pomodoroSessions: number;
  };
  data: {
    tasks: unknown[];
    projects: unknown[];
    milestones: unknown[];
    labels: unknown[];
    categories: unknown[];
    themes: unknown[];
    habits: unknown[];
    habitLogs: unknown[];
    flashcardDecks: unknown[];
    flashcards: unknown[];
    examGoals: unknown[];
    learningGoals: unknown[];
    studyStreaks: unknown[];
    scheduleEvents: unknown[];
    timeEntries: unknown[];
    pomodoroSessions: unknown[];
  };
}

/**
 * iCal export filters
 */
export interface ICalExportFilters {
  includeCompleted?: boolean;
  includeTasks?: boolean;
  includeEvents?: boolean;
}

/**
 * Import task request
 */
export interface TaskImportRequest {
  tasks: Array<{
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    dueDate?: string;
    estimatedHours?: number;
    labels?: string[];
    projectId?: number;
    themeId?: number;
  }>;
  skipExisting?: boolean;
}

/**
 * Import result
 */
export interface ImportResult {
  success: boolean;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
}

/**
 * Restore request mode
 */
export type RestoreMode = 'skip' | 'overwrite';

/**
 * Restore response
 */
export interface RestoreResponse {
  success: boolean;
  timestamp: string;
  mode: RestoreMode;
  imported: Record<string, number>;
  skipped: Record<string, number>;
  errors: string[];
  totalErrors: number;
}

/**
 * CSV import request
 */
export interface CsvImportRequest {
  csv: string;
  skipExisting?: boolean;
}
