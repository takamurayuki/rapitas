/**
 * 知識ベースシステム - フロントエンド型定義
 */

export type KnowledgeSourceType =
  | 'agent_execution'
  | 'user_learning'
  | 'task_pattern'
  | 'distilled_procedure'
  | 'consolidated'
  | 'concern'
  | 'hypothesis'
  | 'idea_box'
  | 'retrospective'
  | 'failure_lesson';

// `category` is a plain string column shared by several unrelated producers
// (distilled-knowledge categories, concern-backlog types, hypothesis domains,
// idea-box categories — see services/memory/{distillation,concern-backlog-service,
// hypothesis-service,idea-box-service}.ts on the backend) rather than one closed
// enum, so this union must track all of them or KnowledgeEntryCard's
// `t(`categories.${entry.category}`)` throws MISSING_MESSAGE for real rows.
export type KnowledgeCategory =
  | 'procedure'
  | 'fact'
  | 'pattern'
  | 'preference'
  | 'insight'
  | 'general'
  | 'bug'
  | 'refactor'
  | 'security'
  | 'perf'
  | 'other'
  | 'codebase'
  | 'agent-behavior'
  | 'architecture'
  | 'improvement'
  | 'bug_noticed'
  | 'tech_debt'
  | 'ux'
  | 'feature'
  | 'performance';

export type ForgettingStage = 'active' | 'dormant' | 'archived';
export type ValidationStatus = 'pending' | 'validated' | 'rejected' | 'conflict';
export type ContradictionResolution = 'keep_a' | 'keep_b' | 'merge' | 'dismiss';

export interface KnowledgeEntry {
  id: number;
  sourceType: KnowledgeSourceType;
  sourceId: string | null;
  title: string;
  content: string;
  contentHash: string;
  category: KnowledgeCategory;
  tags: string[];
  confidence: number;
  accessCount: number;
  lastAccessedAt: string | null;
  forgettingStage: ForgettingStage;
  decayScore: number;
  lastDecayAt: string;
  pinnedUntil: string | null;
  validationStatus: ValidationStatus;
  validatedAt: string | null;
  validationMethod: string | null;
  themeId: number | null;
  taskId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSearchResult extends KnowledgeEntry {
  similarity: number;
}

export interface KnowledgeContradiction {
  id: number;
  entryAId: number;
  entryBId: number;
  contradictionType: string;
  description: string | null;
  resolution: ContradictionResolution | null;
  resolvedAt: string | null;
  createdAt: string;
  entryA: Pick<KnowledgeEntry, 'id' | 'title' | 'content' | 'category' | 'confidence'>;
  entryB: Pick<KnowledgeEntry, 'id' | 'title' | 'content' | 'category' | 'confidence'>;
}

export interface ConsolidationRun {
  id: number;
  runDate: string;
  status: string;
  entriesProcessed: number;
  entriesMerged: number;
  entriesCreated: number;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface TimelineEvent {
  id: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  correlationId: string | null;
  createdAt: string;
}

export interface QueueStatus {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  deadLetter: number;
  embeddingCount: number;
}

export interface KnowledgeStats {
  totalEntries: number;
  byCategory: Record<string, number>;
  byStage: Record<string, number>;
  byValidation: Record<string, number>;
  bySource: Record<string, number>;
  averageConfidence: number;
  averageDecayScore: number;
  recentlyAccessed: number;
  /** Open (unresolved) contradiction pairs — the nightly sweep's convergence signal. */
  unresolvedContradictions?: number;
  /** Injected-knowledge → task-outcome causal aggregate (last 30 days). */
  effectiveness?: {
    sampledTasks: number;
    successRate: number;
    declarationRate: number;
    usageRate: number;
    wrongFlagged: number;
    avgInjected: number;
  };
}

export interface KnowledgeListResponse {
  entries: KnowledgeEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RAGContext {
  query: string;
  entries: Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
    similarity: number;
  }>;
  contextText: string;
}
