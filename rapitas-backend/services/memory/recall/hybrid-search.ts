/**
 * hybrid-search
 *
 * The single recall entry point: runs the vector channel (rag/search.ts) and
 * the lexical bigram channel (lexical-index.ts) in parallel, fuses them with
 * RRF, hydrates lexical-only hits from the DB, optionally retries without the
 * theme scope, and records ONE `memory_recall_attempt` timeline event per call
 * (including empty results) so recall rate is measurable.
 *
 * NOT responsible for outcome reinforcement (outcome-reinforcement.ts) or for
 * rendering the prompt section (workflow-memory-render.ts).
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { searchKnowledge } from '../rag/search';
import { getActiveEmbeddingModel } from '../rag/embedding';
import { appendEvent } from '../timeline';
import { parseTagsAsStrings } from '../utils';
import { lexicalSearch, type LexicalHit } from './lexical-index';
import { fuseRankings } from './rank-fusion';
import { getRecallConfig } from './recall-config';
import type { ForgettingStage, KnowledgeCategory } from '../types';

const log = createLogger('memory:recall:hybrid');

/** Where a recall attempt originated — drives the metrics denominator. */
export type RecallSource = 'workflow' | 'task_rag' | 'api';

/** Options for {@link searchKnowledgeHybrid}. */
export interface HybridSearchOptions {
  query: string;
  limit?: number;
  minSimilarity?: number;
  stages?: ForgettingStage[];
  stageWeights?: Partial<Record<ForgettingStage, number>>;
  themeId?: number;
  category?: KnowledgeCategory;
  /** Override the config's lexical toggle. */
  lexical?: boolean;
  lexicalMinScore?: number;
  /** Retry without themeId when the theme-scoped search returns nothing. */
  themeFallback?: boolean;
  /** When set, one `memory_recall_attempt` event is recorded (fire-and-forget). */
  telemetry?: { source: RecallSource; taskId?: number };
}

/** One recalled entry with channel provenance. */
export interface HybridHit {
  id: number;
  title: string;
  content: string;
  category: string;
  confidence: number;
  forgettingStage: string;
  /** Cosine similarity; 0 when the entry was found by the lexical channel only. */
  similarity: number;
  tags: string[];
  createdAt: Date;
  taskId: number | null;
  validationStatus: string;
  channel: 'vector' | 'lexical' | 'both';
  /** Lexical coverage score (0..1) or null when not a lexical hit. */
  lexicalScore: number | null;
}

type VectorRow = Awaited<ReturnType<typeof searchKnowledge>>[number];

interface PassResult {
  hits: HybridHit[];
  vectorCandidates: number;
  lexicalCandidates: number;
  topSimilarity: number | null;
  topLexical: number | null;
}

/** Fetch KB rows for lexical-only ids, re-applying the eligibility filters. */
async function hydrate(
  ids: number[],
  stages: ForgettingStage[],
  themeId: number | undefined,
  category: KnowledgeCategory | undefined,
): Promise<Map<number, VectorRow>> {
  const out = new Map<number, VectorRow>();
  if (ids.length === 0) return out;
  const where: Record<string, unknown> = {
    id: { in: ids },
    validationStatus: { not: 'rejected' },
    forgettingStage: { in: stages },
  };
  if (themeId !== undefined) where.themeId = themeId;
  if (category !== undefined) where.category = category;
  const rows = await prisma.knowledgeEntry.findMany({
    where,
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      confidence: true,
      forgettingStage: true,
      tags: true,
      createdAt: true,
      taskId: true,
      validationStatus: true,
    },
  });
  for (const r of rows) {
    out.set(r.id, { ...r, tags: parseTagsAsStrings(r.tags), similarity: 0 });
  }
  return out;
}

/**
 * Hybrid (vector + lexical, RRF-fused) knowledge search.
 *
 * Each channel degrades independently: a throwing channel is logged and
 * treated as empty so recall keeps working while, e.g., the embedding model
 * is being downloaded. Deterministic for a fixed KB state.
 *
 * @param options - Query, limits, filters, telemetry. / 検索オプション
 * @returns Fused hits, best first, at most `limit`. / 統合結果
 */
export async function searchKnowledgeHybrid(options: HybridSearchOptions): Promise<HybridHit[]> {
  const cfg = getRecallConfig();
  const {
    query,
    limit = cfg.maxEntries,
    minSimilarity = cfg.minSimilarity,
    stages = cfg.stages,
    stageWeights = cfg.stageWeights,
    category,
    lexical = cfg.lexicalEnabled,
    lexicalMinScore = cfg.lexicalMinScore,
    themeFallback = false,
    telemetry,
  } = options;
  const started = Date.now();

  const runPass = async (themeId: number | undefined): Promise<PassResult> => {
    const [vector, lex] = await Promise.all([
      searchKnowledge({
        query,
        limit: limit * 2,
        minSimilarity,
        forgettingStage: stages,
        stageWeights,
        themeId,
        category,
      }).catch((err: unknown): VectorRow[] => {
        log.warn({ err }, '[recall] vector channel failed — continuing with lexical only');
        return [];
      }),
      lexical
        ? lexicalSearch(query, {
            limit: limit * 2,
            minScore: lexicalMinScore,
            stages,
            stageWeights,
            themeId,
            category,
          }).catch((err: unknown): LexicalHit[] => {
            log.warn({ err }, '[recall] lexical channel failed — continuing with vector only');
            return [];
          })
        : Promise.resolve([] as LexicalHit[]),
    ]);

    const fused = fuseRankings(
      vector.map((v) => v.id),
      lex.map((l) => l.id),
    ).slice(0, limit);
    const vectorById = new Map(vector.map((v) => [v.id, v]));
    const lexById = new Map(lex.map((l) => [l.id, l]));
    const hydrated = await hydrate(
      fused.filter((f) => !vectorById.has(f.id)).map((f) => f.id),
      stages,
      themeId,
      category,
    );

    const hits: HybridHit[] = [];
    for (const f of fused) {
      const row = vectorById.get(f.id) ?? hydrated.get(f.id);
      if (!row) continue; // lexical index was stale vs. DB eligibility
      const l = lexById.get(f.id);
      hits.push({
        ...row,
        channel:
          f.vectorRank !== null && f.lexicalRank !== null
            ? 'both'
            : f.vectorRank !== null
              ? 'vector'
              : 'lexical',
        lexicalScore: l ? l.score : null,
      });
    }
    return {
      hits,
      vectorCandidates: vector.length,
      lexicalCandidates: lex.length,
      topSimilarity: vector.length > 0 ? Math.max(...vector.map((v) => v.similarity)) : null,
      topLexical: lex.length > 0 ? Math.max(...lex.map((l) => l.score)) : null,
    };
  };

  let pass = await runPass(options.themeId);
  let themeFallbackUsed = false;
  if (pass.hits.length === 0 && themeFallback && options.themeId !== undefined) {
    pass = await runPass(undefined);
    themeFallbackUsed = true;
  }

  if (telemetry) {
    // Fire-and-forget: metrics must never slow down or break context building.
    void appendEvent({
      eventType: 'memory_recall_attempt',
      correlationId: telemetry.taskId !== undefined ? `task_${telemetry.taskId}` : undefined,
      payload: {
        source: telemetry.source,
        taskId: telemetry.taskId ?? null,
        model: getActiveEmbeddingModel(),
        stages,
        lexicalEnabled: lexical,
        vectorCandidates: pass.vectorCandidates,
        lexicalCandidates: pass.lexicalCandidates,
        returned: pass.hits.length,
        topSimilarity: pass.topSimilarity,
        topLexical: pass.topLexical,
        themeFallbackUsed,
        durationMs: Date.now() - started,
      },
    }).catch((err: unknown) => {
      log.debug({ err }, '[recall] failed to record memory_recall_attempt');
    });
  }

  return pass.hits;
}
