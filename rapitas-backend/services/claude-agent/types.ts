import type { AIProvider } from '../../utils/ai-client';

export type SubtaskProposal = {
  title: string;
  description: string;
  estimatedHours?: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  order: number;
  dependencies?: number[];
};

export type TaskAnalysisResult = {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedTotalHours: number;
  suggestedSubtasks: SubtaskProposal[];
  reasoning: string;
  tips?: string[];
};

export type AgentConfig = {
  maxSubtasks: number;
  priority: 'aggressive' | 'balanced' | 'conservative';
  provider?: AIProvider;
  model?: string;
};

export type PromptClarificationQuestion = {
  id: string;
  question: string;
  options?: string[];
  isRequired: boolean;
  category:
    | 'scope'
    | 'technical'
    | 'requirements'
    | 'constraints'
    | 'integration'
    | 'testing'
    | 'deliverables';
};

export type PromptQualityRubric = {
  clarity: { score: number; details: string };
  completeness: { score: number; details: string; missing: string[] };
  technicalSpecificity: { score: number; details: string };
  executability: { score: number; details: string };
  context: { score: number; details: string };
};

export type ScoreBreakdownItem = {
  score: number;
  reason: string;
  missing?: string[];
};

export type OptimizedPromptResult = {
  optimizedPrompt: string;
  structuredSections: {
    objective: string;
    context: string;
    requirements: string[];
    constraints: string[];
    deliverables: string[];
    technicalDetails?: string;
  };
  clarificationQuestions?: PromptClarificationQuestion[];
  promptQuality: {
    score: number;
    breakdown?: {
      clarity: ScoreBreakdownItem;
      completeness: ScoreBreakdownItem;
      technicalSpecificity: ScoreBreakdownItem;
      executability: ScoreBreakdownItem;
      context: ScoreBreakdownItem;
    };
    issues: string[];
    suggestions: string[];
  };
};
