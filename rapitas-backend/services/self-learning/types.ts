/**
 * 自己学習型AIエージェント - 型定義
 */

// --- Experiment ---
export type ExperimentPhase =
  | 'created'
  | 'researching'
  | 'hypothesizing'
  | 'planning'
  | 'executing'
  | 'evaluating'
  | 'learning'
  | 'completed'
  | 'failed';

export interface ExperimentResearch {
  codeAnalysis?: string[];
  documentSearch?: string[];
  memorySearch?: string[];
  relatedExperiments?: number[];
  summary: string;
}

export interface ExperimentPlan {
  steps: PlanStep[];
  estimatedDuration?: number;
  dependencies?: string[];
  risks?: string[];
}

export interface PlanStep {
  id: number;
  description: string;
  type: 'code_change' | 'command' | 'file_edit' | 'test' | 'verification';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  details?: string;
}

export interface ExperimentEvaluation {
  testsPassed: number;
  testsFailed: number;
  errorsEncountered: string[];
  performanceMetrics?: Record<string, number>;
  overallSuccess: boolean;
  notes?: string;
}

export interface ExperimentLearning {
  successFactors: string[];
  failureReasons: string[];
  improvements: string[];
  newKnowledge: string[];
  patternId?: number;
}

export interface CreateExperimentInput {
  taskId?: number;
  title: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateExperimentInput {
  status?: ExperimentPhase;
  research?: ExperimentResearch;
  hypothesis?: string;
  plan?: ExperimentPlan;
  execution?: Record<string, unknown>;
  result?: Record<string, unknown>;
  evaluation?: ExperimentEvaluation;
  learning?: ExperimentLearning;
  confidence?: number;
}

// --- Hypothesis ---
export type HypothesisStatus = 'proposed' | 'testing' | 'validated' | 'invalidated' | 'revised';

export interface CreateHypothesisInput {
  experimentId: number;
  content: string;
  reasoning?: string;
  confidence?: number;
  priority?: number;
  parentId?: number;
}

export interface HypothesisTestResult {
  passed: boolean;
  evidence: string[];
  metrics?: Record<string, number>;
}

// --- Critic ---
export interface CriticScore {
  accuracy: number; // 0-1.0
  logic: number; // 0-1.0
  coverage: number; // 0-1.0
}

export type CriticPhase = 'hypothesis' | 'plan' | 'execution';

export interface CriticReviewInput {
  experimentId: number;
  phase: CriticPhase;
  targetContent: string;
  context?: string;
}

export interface CriticReviewResult {
  score: CriticScore;
  overallScore: number;
  feedback: string;
  suggestions: string[];
  issues: string[];
}

// --- Knowledge Graph ---
export type KnowledgeNodeType = 'concept' | 'problem' | 'solution' | 'technology' | 'pattern';

export type KnowledgeEdgeType =
  | 'related'
  | 'causes'
  | 'solves'
  | 'requires'
  | 'part_of'
  | 'similar_to';

export interface CreateNodeInput {
  label: string;
  nodeType: KnowledgeNodeType;
  description?: string;
  properties?: Record<string, unknown>;
  weight?: number;
}

export interface CreateEdgeInput {
  fromNodeId: number;
  toNodeId: number;
  edgeType: KnowledgeEdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface SubgraphQuery {
  nodeId: number;
  depth?: number;
  edgeTypes?: KnowledgeEdgeType[];
  maxNodes?: number;
}

export interface GraphNode {
  id: number;
  label: string;
  nodeType: KnowledgeNodeType;
  description: string | null;
  properties: Record<string, unknown>;
  weight: number;
}

export interface GraphEdge {
  id: number;
  fromNodeId: number;
  toNodeId: number;
  edgeType: KnowledgeEdgeType;
  weight: number;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Learning Engine ---
export type LearningPatternType =
  | 'success_strategy'
  | 'failure_pattern'
  | 'optimization'
  | 'anti_pattern';

export type LearningCategory =
  | 'bug_fix'
  | 'feature_implementation'
  | 'refactoring'
  | 'debugging'
  | 'testing';

export interface PatternCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'exists';
  value: string;
}

export interface PatternAction {
  type: 'apply_template' | 'suggest_approach' | 'warn' | 'auto_fix';
  description: string;
  template?: string;
}

export interface CreatePatternInput {
  patternType: LearningPatternType;
  category: LearningCategory;
  description: string;
  conditions?: PatternCondition[];
  actions?: PatternAction[];
  confidence?: number;
}

export interface LearningStats {
  totalExperiments: number;
  successRate: number;
  topPatterns: Array<{ id: number; description: string; occurrences: number }>;
  recentLearnings: string[];
  promptImprovements: number;
  knowledgeGraphSize: { nodes: number; edges: number };
}

// --- Growth Timeline ---
export interface GrowthTimelineEntry {
  date: string; // YYYY-MM-DD
  knowledgeNodes: number;
  knowledgeEdges: number;
  learningPatterns: number;
  experimentsCompleted: number;
  successRate: number;
  avgConfidence: number;
  promptImprovements: number;
}

export interface GrowthTimeline {
  timeline: GrowthTimelineEntry[];
  period: '7d' | '30d' | 'all';
  totalDays: number;
}

// --- Memory Overview ---
export interface MemoryOverview {
  totalMemorySize: {
    nodes: number;
    patterns: number;
    episodes: number;
    experiments: number;
  };
  growthRate: {
    weekly: number; // パーセンテージ
    monthly: number;
  };
  currentSuccessRate: number;
  memoryStrength: {
    score: number; // 0-100
    level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  };
  recentHighlights: {
    latestPatterns: Array<{
      id: number;
      description: string;
      confidence: number;
      createdAt: string;
    }>;
    latestNodes: Array<{
      id: number;
      label: string;
      nodeType: string;
      weight: number;
      createdAt: string;
    }>;
  };
  knowledgeDistribution: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
}

// --- Episode Memory ---
export type EpisodePhase = 'research' | 'hypothesis' | 'plan' | 'execute' | 'evaluate' | 'learn';

export type EpisodeOutcome = 'success' | 'failure' | 'partial';

export type EmotionalTag = 'surprising' | 'expected' | 'frustrating' | 'satisfying';

export interface CreateEpisodeInput {
  experimentId: number;
  phase: EpisodePhase;
  content: string;
  context?: Record<string, unknown>;
  outcome?: EpisodeOutcome;
  emotionalTag?: EmotionalTag;
  importance?: number;
}

// --- Prompt Evolution ---
export interface CreatePromptEvolutionInput {
  experimentId?: number;
  category: string;
  beforePrompt: string;
  afterPrompt: string;
  improvement?: string;
  performanceDelta?: number;
}
