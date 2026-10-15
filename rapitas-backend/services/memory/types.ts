/**
 * メモリ/知識管理システム - 型定義
 */
// NOTE: type-only import — `effectiveness.ts` imports `EffectivenessResult`
// back from here, so the cycle is erased at compile time and never a runtime one.
import type { KnowledgeEffectiveness } from './effectiveness';

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
  | 'distillation_completed'
  | 'task_knowledge_extracted'
  | 'knowledge_reminder_sent'
  | 'knowledge_reviewed'
  | 'task_outcome'
  | 'memory_retrieval'
  | 'knowledge_effectiveness'
  | 'adversarial_review'
  | 'ideation_calibration'
  | 'retro_review_failed'
  | 'playbook_generated'
  | 'playbook_generation_failed'
  | 'context_section_metrics'
  | 'memory_recall_attempt'
  | 'embedding_reindex'
  // NOTE: task 660 — post-verify automation lifecycle (gate → jury → commit/PR),
  // written by verify-completion-inflight so a stuck/blocked verdict can be
  // audited against what the pipeline was actually doing at the time.
  | 'verify_pipeline_started'
  | 'verify_pipeline_settled'
  // NOTE: task 723 — a user-triggered dry-run of the verify gate + jury,
  // recorded so results can be listed/compared without a new table.
  | 'dry_run_executed'
  // NOTE: task 899 — implementer self-verification jobs, recorded so a
  // POST can return immediately and a GET can later recover the result
  // without a new table (see verification-job-store.ts).
  | 'verification_job_started'
  | 'verification_job_finished'
  // NOTE: task 904 — supervision acceptance evidence (intervention, monitor
  // liveness, observation gaps, acceptance snapshots, knowledge-reuse eval).
  // Recorded on TimelineEvent rather than dedicated tables so the same code
  // runs on the live SQLite DB and on the Postgres web build (see
  // services/supervision/supervision-events.ts for the payload contract).
  | 'supervision_intervention'
  | 'supervision_monitor_heartbeat'
  | 'supervision_observation_gap'
  | 'supervision_acceptance_snapshot'
  | 'supervision_knowledge_reuse_eval';

export type ActorType = 'user' | 'agent' | 'system';

// --- MemoryTaskQueue ---
export type MemoryTaskType =
  | 'embed'
  | 'consolidate'
  | 'validate'
  | 'forget_sweep'
  | 'distill'
  | 'detect_contradiction'
  | 'reembed';

export type QueueTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter';

// --- MemoryJournal ---
export type JournalOperationType = 'create' | 'update' | 'delete';
export type JournalStatus = 'pending' | 'committed' | 'failed';

// --- ConsolidationRun ---
export type ConsolidationStatus = 'running' | 'completed' | 'failed';

// --- Contradiction ---
export type ContradictionType = 'factual' | 'procedural' | 'preference';
export type ContradictionResolution = 'keep_a' | 'keep_b' | 'merge' | 'dismiss';

// --- Knowledge effectiveness ---
/**
 * Discriminated result of an effectiveness aggregation. `unknown` distinguishes
 * "the samples could not be read" (a DB/query failure) from a genuine zero
 * aggregate (`ok` with `data.sampledTasks === 0`), which a bare `successRate:
 * number` could not — the caller is forced to branch at compile time.
 */
export type EffectivenessResult =
  | { status: 'ok'; data: KnowledgeEffectiveness }
  | { status: 'unknown'; reason: string };

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
  /** Citation location (file path/URL/etc.), stronger than sourceId. / 出典 */
  sourceRef?: string;
  /** Free-text conditions under which this knowledge applies. / 適用条件 */
  applicabilityConditions?: string;
  /** Optional expiry for time-bound knowledge. / 有効期限 */
  expiresAt?: Date;
  /** Known counter-evidence / exception cases. / 反証・例外 */
  counterEvidence?: string;
}

export interface UpdateKnowledgeEntryInput {
  title?: string;
  content?: string;
  category?: KnowledgeCategory;
  tags?: string[];
  confidence?: number;
  themeId?: number;
  taskId?: number;
  /** Citation location (file path/URL/etc.), stronger than sourceId. / 出典 */
  sourceRef?: string;
  /** Free-text conditions under which this knowledge applies. / 適用条件 */
  applicabilityConditions?: string;
  /** Optional expiry for time-bound knowledge. / 有効期限 */
  expiresAt?: Date;
  /** Known counter-evidence / exception cases. / 反証・例外 */
  counterEvidence?: string;
}

export interface KnowledgeSearchOptions {
  query: string;
  limit?: number;
  minSimilarity?: number;
  /** Single stage (legacy) or a set of stages to recall from (`{ in }`). */
  forgettingStage?: ForgettingStage | ForgettingStage[];
  category?: KnowledgeCategory;
  themeId?: number;
  /** Per-stage rank multiplier (missing stage → 1). Only affects ordering. */
  stageWeights?: Partial<Record<ForgettingStage, number>>;
  /** Vector candidate pool = limit × multiplier (defaults to recall config). */
  candidateMultiplier?: number;
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
