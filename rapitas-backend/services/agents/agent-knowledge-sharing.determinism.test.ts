/**
 * agent-knowledge-sharing.determinism.test
 *
 * Locks the shared-knowledge pattern ranking guarantee: when learning patterns
 * tie on computed relevance, the top-5 slice injected into the agent prompt is
 * ordered deterministically by pattern id.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindUnique = mock(() =>
  Promise.resolve({
    id: 1,
    title: 'deploy the service',
    description: '',
    themeId: null,
    taskLabels: [],
    theme: null,
  }),
);
const mockLearningPatternFindMany = mock(() => Promise.resolve([]));
const mockKnowledgeEntryFindMany = mock(() => Promise.resolve([]));
const mockPromptEvolutionFindMany = mock(() => Promise.resolve([]));

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {
    task: { findUnique: mockTaskFindUnique, findFirst: mock(() => Promise.resolve(null)) },
    learningPattern: { findMany: mockLearningPatternFindMany },
    knowledgeEntry: { findMany: mockKnowledgeEntryFindMany },
    promptEvolution: { findMany: mockPromptEvolutionFindMany },
  },
}));

const { gatherSharedKnowledge } = await import('./agent-knowledge-sharing');

/** A success pattern whose single titleKeyword matches the task → equal relevance for all. */
const pattern = (id: number) => ({
  id,
  patternType: 'success_strategy',
  category: 'general',
  description: `pattern ${id}`,
  confidence: 0.8,
  occurrences: 3,
  conditions: JSON.stringify({ titleKeywords: ['deploy'] }),
  actions: '[]',
});

describe('gatherSharedKnowledge — stable pattern order on equal relevance', () => {
  beforeEach(() => {
    mockTaskFindUnique.mockReset();
    mockTaskFindUnique.mockResolvedValue({
      id: 1,
      title: 'deploy the service',
      description: '',
      themeId: null,
      taskLabels: [],
      theme: null,
    });
    mockLearningPatternFindMany.mockReset();
    mockKnowledgeEntryFindMany.mockReset();
    mockKnowledgeEntryFindMany.mockResolvedValue([]);
    mockPromptEvolutionFindMany.mockReset();
    mockPromptEvolutionFindMany.mockResolvedValue([]);
  });

  it('breaks relevance ties by pattern id ascending', async () => {
    // Non-id input order proves the sort, not the DB row order, decides the slice.
    mockLearningPatternFindMany.mockResolvedValue([8, 3, 1, 5, 2].map(pattern));

    const result = await gatherSharedKnowledge(1);

    expect(result.patterns.map((p) => p.id)).toEqual([1, 2, 3, 5, 8]);
  });
});
