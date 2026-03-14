/**
 * Task analysis, subtask, and constraint type definitions.
 */

/**
 * Task analysis result.
 */
export interface TaskAnalysisResult {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedDuration?: number; 
  subtasks?: SubtaskDefinition[];
  tips?: string[];
  risks?: string[];
}

/**
 * Subtask definition.
 */
export interface SubtaskDefinition {
  order: number;
  title: string;
  description: string;
  estimatedDuration?: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dependencies?: number[];
  parallelizable?: boolean;
}

/**
 * Task constraints.
 */
export interface TaskConstraints {
  maxFiles?: number; 
  allowedPaths?: string[]; 
  forbiddenPaths?: string[]; 
  allowedCommands?: string[]; 
  forbiddenCommands?: string[]; 
}
