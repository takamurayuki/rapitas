/**
 * Task Knowledge Suggestions
 *
 * Recommends next tasks based on accumulated knowledge entries.
 * Uses RAG vector search to find relevant knowledge, then analyzes
 * gaps and patterns to suggest actionable tasks.
 *
 * Connects: KnowledgeEntry → Task suggestions (the missing feedback loop).
 */
import { PrismaClient } from '@prisma/client';
import { searchKnowledge } from '../memory/rag/search';
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const log = createLogger('task-knowledge-suggestions');

/** A task recommendation derived from knowledge base analysis. */
export interface KnowledgeSuggestion {
  title: string;
  description: string;
  priority: string;
  source: 'knowledge-pattern' | 'knowledge-gap' | 'knowledge-followup';
  relatedKnowledgeIds: number[];
  confidence: number;
}

/**
 * Generate task suggestions based on accumulated knowledge entries.
 *
 * Strategy:
 *   1. Fetch recent active knowledge entries for the theme
 *   2. Identify patterns (distilled procedures that haven't been applied)
 *   3. Find gaps (low-confidence or conflicting knowledge)
 *   4. Use AI to synthesize actionable task suggestions
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param themeId - Theme to scope suggestions / 対象テーマ
 * @param limit - Maximum suggestions to return / 最大件数
 * @returns Knowledge-based task suggestions / 知識ベースのタスク提案
 */
export async function getKnowledgeBasedSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number = 5,
): Promise<KnowledgeSuggestion[]> {
  try {
    // Fetch theme context
    const theme = await prisma.theme.findUnique({
      where: { id: themeId },
      select: { name: true, description: true },
    });
    if (!theme) return [];

    // Fetch active knowledge entries for this theme
    const knowledgeEntries = await prisma.knowledgeEntry.findMany({
      where: {
        themeId,
        forgettingStage: 'active',
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        confidence: true,
        sourceType: true,
        validationStatus: true,
        tags: true,
      },
    });

    if (knowledgeEntries.length === 0) return [];

    // Identify knowledge patterns
    const patterns = knowledgeEntries.filter((e) => e.sourceType === 'distilled_procedure');
    const lowConfidence = knowledgeEntries.filter((e) => e.confidence < 0.6);
    const conflicts = knowledgeEntries.filter((e) => e.validationStatus === 'conflict');

    // Build suggestion context for AI
    const knowledgeSummary = knowledgeEntries
      .slice(0, 15)
      .map((e) => `- [${e.category}] ${e.title} (信頼度: ${(e.confidence * 100).toFixed(0)}%)`)
      .join('\n');

    const patternSummary = patterns
      .slice(0, 5)
      .map((e) => `- ${e.title}: ${e.content.slice(0, 100)}`)
      .join('\n');

    const gapSummary = [...lowConfidence, ...conflicts]
      .slice(0, 5)
      .map(
        (e) =>
          `- ${e.title} (信頼度: ${(e.confidence * 100).toFixed(0)}%, 状態: ${e.validationStatus})`,
      )
      .join('\n');

    const systemPrompt = `You are a task recommendation engine. Based on the accumulated knowledge entries,
suggest actionable tasks that would be valuable to work on next.

Rules:
- Suggest 3-5 tasks maximum
- Each task should address a knowledge gap, apply a learned pattern, or build on existing insights
- Prioritize tasks that resolve low-confidence or conflicting knowledge
- Output valid JSON array

Output format:
[{"title": "タスク名", "description": "詳細", "priority": "high|medium|low", "source": "knowledge-pattern|knowledge-gap|knowledge-followup", "confidence": 0.8}]`;

    const userMessage = `テーマ: ${theme.name}
${theme.description ? `説明: ${theme.description}` : ''}

## 蓄積された知識 (${knowledgeEntries.length}件)
${knowledgeSummary}

## 抽出されたパターン (${patterns.length}件)
${patternSummary || 'なし'}

## 改善が必要な知識 (${lowConfidence.length + conflicts.length}件)
${gapSummary || 'なし'}

これらの知識に基づいて、次に取り組むべきタスクを提案してください。`;

    const response = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt,
      maxTokens: 1024,
      enableRAG: true,
      ragThemeId: themeId,
    });

    // Parse AI response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.warn('AI response did not contain valid JSON array for knowledge suggestions');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title: string;
      description: string;
      priority: string;
      source: string;
      confidence: number;
    }>;

    // Map related knowledge IDs based on content relevance
    const suggestions: KnowledgeSuggestion[] = parsed.slice(0, limit).map((s) => {
      const relatedIds = knowledgeEntries
        .filter((e) => {
          const titleLower = s.title.toLowerCase();
          return (
            e.title.toLowerCase().includes(titleLower.slice(0, 10)) ||
            titleLower.includes(e.title.toLowerCase().slice(0, 10))
          );
        })
        .map((e) => e.id)
        .slice(0, 3);

      return {
        title: s.title,
        description: s.description,
        priority: s.priority || 'medium',
        source: (s.source as KnowledgeSuggestion['source']) || 'knowledge-followup',
        relatedKnowledgeIds: relatedIds,
        confidence: s.confidence || 0.7,
      };
    });

    log.info(
      { themeId, suggestions: suggestions.length, knowledgeEntries: knowledgeEntries.length },
      'Knowledge-based suggestions generated',
    );

    return suggestions;
  } catch (error) {
    log.error({ err: error, themeId }, 'Failed to generate knowledge-based suggestions');
    return [];
  }
}
