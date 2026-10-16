import { describe, test, expect, mock } from 'bun:test';

const mockFindFirst = mock(() => Promise.resolve<{ id: number } | null>(null));
const mockCreate = mock((args: { data: Record<string, unknown> }) =>
  Promise.resolve({ id: 1, ...args.data }),
);
const mockFindMany = mock(() =>
  Promise.resolve<Array<{ sourceId: string | null; tags: string }>>([]),
);
const mockPrisma = {
  knowledgeEntry: {
    findFirst: mockFindFirst,
    create: mockCreate,
    findMany: mockFindMany,
  },
};
mock.module('../../config', () => ({
  prisma: mockPrisma,
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const mockSendAIMessage = mock(() => Promise.resolve({ content: 'response', tokensUsed: 1 }));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const mockGenerateEmbedding = mock(() =>
  Promise.resolve({ embedding: [1, 2, 3], model: 'test-model', dimension: 3 }),
);
mock.module('../memory/rag/embedding', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const mockUpsertEmbedding = mock(() => {});
mock.module('../memory/rag/vector-index', () => ({
  upsertEmbedding: mockUpsertEmbedding,
}));

const {
  generateTeachingMaterial,
  evaluateStudentOutput,
  executeWithTeacherStudent,
  getTeachingStats,
} = await import('./teacher-student');

describe('generateTeachingMaterial', () => {
  test('creates a new KnowledgeEntry and embeds it when no duplicate exists', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockClear();
    mockUpsertEmbedding.mockClear();

    const result = await generateTeachingMaterial('branch-naming', 'Generate branch names');

    expect(result.taskType).toBe('branch-naming');
    expect(result.exampleCount).toBe(5);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpsertEmbedding).toHaveBeenCalledTimes(1);
  });

  test('skips creation and returns exampleCount 0 when identical content already exists', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 42 });
    mockCreate.mockClear();

    const result = await generateTeachingMaterial('branch-naming', 'Generate branch names');

    expect(result.knowledgeEntryId).toBe(42);
    expect(result.exampleCount).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('does not fail the whole call when embedding generation errors', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockGenerateEmbedding.mockImplementationOnce(() => Promise.reject(new Error('embed fail')));

    const result = await generateTeachingMaterial('summarize', 'desc');
    expect(result.exampleCount).toBe(5);
  });

  test('includes seed examples in the prompt when provided', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockSendAIMessage.mockClear();
    await generateTeachingMaterial('translate', 'desc', [{ input: 'a', output: 'b' }]);
    const callArg = mockSendAIMessage.mock.calls[0][0];
    expect(callArg.messages[0].content).toContain('seed examples');
  });
});

describe('evaluateStudentOutput', () => {
  test('parses a passing score from the Teacher response', async () => {
    mockSendAIMessage.mockResolvedValueOnce({
      content: '{"score": 85, "feedback": "good", "correctedOutput": null}',
      tokensUsed: 1,
    });
    const result = await evaluateStudentOutput('summarize', 'in', 'out', 'fmt');
    expect(result).toEqual({
      score: 85,
      passed: true,
      feedback: 'good',
      correctedOutput: undefined,
    });
  });

  test('parses a failing score and stores the correction', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockClear();
    mockSendAIMessage.mockResolvedValueOnce({
      content: '{"score": 40, "feedback": "bad", "correctedOutput": "better output"}',
      tokensUsed: 1,
    });
    const result = await evaluateStudentOutput('summarize', 'in', 'out', 'fmt');
    expect(result.score).toBe(40);
    expect(result.passed).toBe(false);
    expect(result.correctedOutput).toBe('better output');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('does not store a duplicate correction when one already exists', async () => {
    mockFindFirst.mockResolvedValueOnce({ id: 5 });
    mockCreate.mockClear();
    mockSendAIMessage.mockResolvedValueOnce({
      content: '{"score": 30, "feedback": "bad", "correctedOutput": "fix"}',
      tokensUsed: 1,
    });
    await evaluateStudentOutput('summarize', 'in', 'out', 'fmt');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('returns a low-confidence default when the Teacher response has no JSON', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'not json at all', tokensUsed: 1 });
    const result = await evaluateStudentOutput('summarize', 'in', 'out', 'fmt');
    expect(result.score).toBe(50);
    expect(result.passed).toBe(false);
  });

  test('degrades to an accepting default when sendAIMessage throws', async () => {
    mockSendAIMessage.mockImplementationOnce(() => Promise.reject(new Error('llm down')));
    const result = await evaluateStudentOutput('summarize', 'in', 'out', 'fmt');
    expect(result.score).toBe(50);
    expect(result.passed).toBe(true);
  });
});

describe('executeWithTeacherStudent', () => {
  test('returns the student output immediately when skipEvaluation is set', async () => {
    mockSendAIMessage.mockResolvedValueOnce({ content: 'student says hi', tokensUsed: 1 });
    const result = await executeWithTeacherStudent('t', 'sys', 'msg', 'fmt', {
      skipEvaluation: true,
    });
    expect(result).toEqual({ output: 'student says hi', source: 'student', score: -1 });
  });

  test('returns student output when the Teacher evaluation passes', async () => {
    mockSendAIMessage
      .mockResolvedValueOnce({ content: 'student output', tokensUsed: 1 }) // student call
      .mockResolvedValueOnce({
        content: '{"score": 90, "feedback": "ok", "correctedOutput": null}',
        tokensUsed: 1,
      }); // evaluation call
    const result = await executeWithTeacherStudent('t', 'sys', 'msg', 'fmt');
    expect(result).toEqual({ output: 'student output', source: 'student', score: 90 });
  });

  test('returns the corrected output when evaluation fails but a correction is given', async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    mockSendAIMessage
      .mockResolvedValueOnce({ content: 'bad student output', tokensUsed: 1 })
      .mockResolvedValueOnce({
        content: '{"score": 30, "feedback": "bad", "correctedOutput": "corrected"}',
        tokensUsed: 1,
      });
    const result = await executeWithTeacherStudent('t', 'sys', 'msg', 'fmt');
    expect(result).toEqual({ output: 'corrected', source: 'teacher-corrected', score: 30 });
  });

  test('escalates to the paid API when evaluation fails without a correction', async () => {
    mockSendAIMessage
      .mockResolvedValueOnce({ content: 'bad output', tokensUsed: 1 }) // student
      .mockResolvedValueOnce({
        content: '{"score": 20, "feedback": "bad", "correctedOutput": null}',
        tokensUsed: 1,
      }) // evaluation
      .mockResolvedValueOnce({ content: 'escalated output', tokensUsed: 1 }); // escalation
    const result = await executeWithTeacherStudent('t', 'sys', 'msg', 'fmt');
    expect(result).toEqual({ output: 'escalated output', source: 'escalated', score: 20 });
  });
});

describe('getTeachingStats', () => {
  test('returns an empty array when there are no teaching entries', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    expect(await getTeachingStats()).toEqual([]);
  });

  test('counts materials and corrections per task type', async () => {
    mockFindMany.mockResolvedValueOnce([
      { sourceId: 'teaching:branch-naming', tags: JSON.stringify(['teaching:branch-naming']) },
      {
        sourceId: 'correction:branch-naming:123',
        tags: JSON.stringify(['teaching:branch-naming']),
      },
      { sourceId: 'teaching:summarize', tags: JSON.stringify(['teaching:summarize']) },
    ]);
    const stats = await getTeachingStats();
    expect(stats).toEqual(
      expect.arrayContaining([
        { taskType: 'branch-naming', materials: 1, corrections: 1 },
        { taskType: 'summarize', materials: 1, corrections: 0 },
      ]),
    );
  });

  test('skips entries with no recognizable teaching tag', async () => {
    mockFindMany.mockResolvedValueOnce([{ sourceId: 'x', tags: JSON.stringify(['unrelated']) }]);
    expect(await getTeachingStats()).toEqual([]);
  });

  test('handles a missing/empty tags field gracefully', async () => {
    mockFindMany.mockResolvedValueOnce([{ sourceId: 'x', tags: '' }]);
    expect(await getTeachingStats()).toEqual([]);
  });
});
