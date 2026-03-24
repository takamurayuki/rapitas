/**
 * Unified Task Suggestion Engine
 *
 * Aggregates suggestions from three sources (frequency-based, AI-powered,
 * knowledge-based), deduplicates by title similarity, and returns a
 * ranked list with source attribution and confidence scores.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';
import { getFrequencyBasedSuggestions } from './task-frequency-suggestions';
import { getKnowledgeBasedSuggestions } from './task-knowledge-suggestions';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('task-unified-suggestions');

/** A unified suggestion with source attribution and scoring. */
export interface UnifiedSuggestion {
  title: string;
  description: string;
  priority: string;
  source: 'frequency' | 'ai' | 'knowledge' | 'merged';
  confidence: number;
  reason?: string;
  estimatedHours?: number;
  relatedKnowledgeIds?: number[];
}

/**
 * Normalize a title for deduplication (lowercase, trim, remove punctuation).
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[「」『』【】（）()[\]]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Check if two titles are similar enough to be considered duplicates.
 *
 * Uses simple substring matching — if either title contains 60%+ of the
 * other's characters, they're considered duplicates.
 */
function isSimilarTitle(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  // Jaccard-like word overlap
  const wordsA = new Set(na.split(' '));
  const wordsB = new Set(nb.split(' '));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 && intersection / union > 0.6;
}

/**
 * Generate unified task suggestions by aggregating all recommendation sources.
 *
 * Pipeline:
 *   1. Fetch frequency-based suggestions (fast, no API cost)
 *   2. Fetch knowledge-based suggestions (uses local LLM + RAG)
 *   3. Merge and deduplicate by title similarity
 *   4. Score and rank by confidence + source weight
 *
 * AI suggestions are intentionally excluded from the default pipeline to avoid
 * API costs. Use `GET /tasks/suggestions/ai` for on-demand AI suggestions.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param themeId - Theme to scope suggestions / 対象テーマ
 * @param limit - Maximum suggestions to return / 最大件数
 * @returns Ranked unified suggestions / ランク付けされた統合提案
 */
export async function getUnifiedSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number = 8,
): Promise<UnifiedSuggestion[]> {
  const results: UnifiedSuggestion[] = [];

  // Source 1: Frequency-based (fast, always available)
  try {
    const freqSuggestions = await getFrequencyBasedSuggestions(prisma, themeId, 10);
    for (const s of freqSuggestions) {
      results.push({
        title: s.title,
        description: s.description || '',
        priority: s.priority || 'medium',
        source: 'frequency',
        confidence: Math.min(1, 0.5 + (s.frequency || 1) * 0.1),
        estimatedHours: s.estimatedHours,
        reason: `過去に${s.frequency || 1}回実行されたパターン`,
      });
    }
  } catch (error) {
    log.warn({ err: error }, 'Frequency suggestions failed');
  }

  // Source 2: Knowledge-based (uses local LLM + RAG, moderate cost)
  try {
    const knowledgeSuggestions = await getKnowledgeBasedSuggestions(prisma, themeId, 5);
    for (const s of knowledgeSuggestions) {
      results.push({
        title: s.title,
        description: s.description,
        priority: s.priority,
        source: 'knowledge',
        confidence: s.confidence,
        relatedKnowledgeIds: s.relatedKnowledgeIds,
        reason: s.source === 'knowledge-gap'
          ? '知識ベースのギャップを補填'
          : s.source === 'knowledge-pattern'
            ? '蓄積パターンからの提案'
            : '過去の学びに基づくフォローアップ',
      });
    }
  } catch (error) {
    log.warn({ err: error }, 'Knowledge suggestions failed');
  }

  // Deduplicate by title similarity
  const deduplicated: UnifiedSuggestion[] = [];
  for (const suggestion of results) {
    const existing = deduplicated.find((d) => isSimilarTitle(d.title, suggestion.title));
    if (existing) {
      // Merge: keep higher confidence, combine reasons
      if (suggestion.confidence > existing.confidence) {
        existing.title = suggestion.title;
        existing.description = suggestion.description || existing.description;
        existing.confidence = suggestion.confidence;
      }
      existing.source = 'merged';
      existing.reason = `${existing.reason} + ${suggestion.reason}`;
    } else {
      deduplicated.push({ ...suggestion });
    }
  }

  // Sort by confidence descending
  deduplicated.sort((a, b) => b.confidence - a.confidence);

  log.info(
    { themeId, total: results.length, deduplicated: deduplicated.length },
    'Unified suggestions generated',
  );

  return deduplicated.slice(0, limit);
}
