/**
 * メモリ/知識管理システム - 型定義
 */

// --- KnowledgeEntry ---
export type KnowledgeSourceType =
  | 'agent_execution'
  | 'user_learning'
  | 'task_pattern'
  | 'distilled_procedure'
  | 'consolidated';

export type KnowledgeCategory =
  | 'procedure'
  | 'fact'
  | 'pattern'
  | 'preference'
  | 'insight'
  | 'general';

export type ForgettingStage = 'active' | 'dormant' | 'archived';

export type ValidationStatus = 'pending' | 'validated' | 'rejected' | 'conflict';

// --- TimelineEvent ---
export type TimelineEventType =
  | 'task_created'
  | 'task_completed'
  | 'task_updated'
  | 'agent_execution_started'
  | 'agent_execution_completed'
  | 'agent_execution_failed'
  | 'knowledge_created'
  | 'knowledge_updated'
  | 'knowledge_archived'
  | 'consolidation_started'
  | 'consolidation_completed'
  | 'contradiction_detected'
  | 'contradiction_resolved'
  | 'reconsolidation_triggered'
  | 'forgetting_sweep'
  | 'distillation_completed';

export type ActorType = 'user' | 'agent' | 'system';

// --- MemoryTaskQueue ---
export type MemoryTaskType =
  | 'embed'
  | 'consolidate'
  | 'validate'
  | 'forget_sweep'
  | 'distill'
  | 'detect_contradiction';

export type QueueTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

// --- MemoryJournal ---
export type JournalOperationType = 'create' | 'update' | 'delete';
export type JournalStatus = 'pending' | 'committed' | 'failed';

// --- ConsolidationRun ---
export type ConsolidationStatus = 'running' | 'completed' | 'failed';

// --- Contradiction ---
export type ContradictionType = 'factual' | 'procedural' | 'preference';
export type ContradictionResolution = 'keep_a' | 'keep_b' | 'merge' | 'dismiss';

// --- RAG ---
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
}

export interface VectorSearchResult {
  knowledgeEntryId: number;
  similarity: number;
  textPreview: string | null;
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

// --- Service Interfaces ---
export interface CreateKnowledgeEntryInput {
  sourceType: KnowledgeSourceType;
  sourceId?: string;
  title: string;
  content: string;
  category?: KnowledgeCategory;
  tags?: string[];
  confidence?: number;
  themeId?: number;
  taskId?: number;
}

export interface UpdateKnowledgeEntryInput {
  title?: string;
  content?: string;
  category?: KnowledgeCategory;
  tags?: string[];
  confidence?: number;
  themeId?: number;
  taskId?: number;
}

export interface KnowledgeSearchOptions {
  query: string;
  limit?: number;
  minSimilarity?: number;
  forgettingStage?: ForgettingStage;
  category?: KnowledgeCategory;
  themeId?: number;
}

export interface KnowledgeListOptions {
  page?: number;
  limit?: number;
  sourceType?: KnowledgeSourceType;
  category?: KnowledgeCategory;
  forgettingStage?: ForgettingStage;
  validationStatus?: ValidationStatus;
  themeId?: number;
  search?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'confidence' | 'accessCount' | 'decayScore';
  sortOrder?: 'asc' | 'desc';
}

export interface TimelineQueryOptions {
  eventType?: TimelineEventType;
  actorType?: ActorType;
  correlationId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
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
}
