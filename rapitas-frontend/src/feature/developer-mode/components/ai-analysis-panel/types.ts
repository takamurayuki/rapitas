/**
 * ai-analysis-panel/types.ts
 *
 * Shared type definitions for the AIAnalysisPanel feature.
 * Not responsible for runtime validation — types only.
 */

export type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category: 'scope' | 'technical' | 'requirements' | 'constraints';
};

export type StructuredSections = {
  objective: string;
  context: string;
  requirements: string[];
  constraints: string[];
  deliverables: string[];
  technicalDetails?: string;
};

export type PromptQuality = {
  score: number;
  issues: string[];
  suggestions: string[];
};

export type OptimizedPromptResult = {
  optimizedPrompt: string;
  structuredSections: StructuredSections;
  clarificationQuestions: PromptClarificationQuestion[];
  promptQuality: PromptQuality;
  hasQuestions: boolean;
  tokensUsed: number;
  savedPromptId?: number;
  taskInfo?: {
    id: number;
    title: string;
    hasSubtasks: boolean;
    subtaskCount: number;
  };
};

export type SavedPrompt = {
  id: number;
  taskId: number;
  name: string | null;
  originalDescription: string | null;
  optimizedPrompt: string;
  structuredSections: StructuredSections | null;
  qualityScore: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SubtaskInfo = {
  id: number;
  title: string;
};

export type PromptsData = {
  task: {
    id: number;
    title: string;
    description: string | null;
    hasSubtasks: boolean;
  };
  subtasks: SubtaskInfo[];
  prompts: SavedPrompt[];
};

export type TabType = 'analysis' | 'prompt' | 'prompts' | 'dependency' | 'settings';
