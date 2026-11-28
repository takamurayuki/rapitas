/**
 * phase-critic.test
 *
 * Integration tests with a mocked ai-client: what critiquePhase sends and how it
 * judges, and the gate acting on that verdict. Pure parts are covered by
 * phase-critic.input.test.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

const sendAIMessageMock = mock(async () => ({
  content: '{"pass":true,"severity":0,"issues":[]}',
}));
const isAnyApiKeyConfiguredMock = mock(async () => true);
const getDefaultProviderMock = mock(async () => 'anthropic');
/** Aux AI mode the critic sees; 'api' keeps the API-key gate active for the existing cases. */
let auxAiMode: 'cli' | 'api' | 'off' = 'api';

mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: sendAIMessageMock,
  getDefaultProvider: getDefaultProviderMock,
  getDefaultModel: async () => 'configured-critic-model',
  isAnyApiKeyConfigured: isAnyApiKeyConfiguredMock,
}));
mock.module('../../../utils/ai-client/aux-ai-mode', () => ({
  getAuxAiMode: () => auxAiMode,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

/**
 * Prisma double for the AC1 end-to-end test below. Only `./phase-critic`'s own
 * deps (`ai-client`, `logger`) are mocked elsewhere in this file — `prisma` is
 * mocked here so `applyPhaseCriticGate` runs its REAL `gatherCriticContext`
 * (unexported, so it can only be exercised through this entry point) and the
 * REAL `critiquePhase`, proving the DB-declared acceptance criteria survive
 * the whole DB → gate → lens-input chain rather than a hand-built context
 * object (which the sibling test above starts from).
 */
const gateMockPrisma = {
  task: {
    findUnique: mock(() =>
      Promise.resolve<{
        title: string;
        description: string | null;
        acceptanceCriteria: string | null;
      } | null>(null),
    ),
    updateMany: mock(() => Promise.resolve({ count: 1 })),
  },
  workflowTransition: {
    count: mock(() => Promise.resolve(0)),
    findFirst: mock(() => Promise.resolve<{ metadata: string } | null>(null)),
  },
  workflowFile: {
    findFirst: mock(() => Promise.resolve<{ content: string } | null>(null)),
  },
};
mock.module('../../../config/database', () => ({
  prisma: gateMockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../transition-recorder', () => ({ recordTransition: mock(() => Promise.resolve()) }));
mock.module('../workflow-file-utils', () => ({
  archiveWorkflowFile: mock(() => Promise.resolve(true)),
}));
mock.module('../workflow-redispatch', () => ({
  REDISPATCH_DELAY_MS: 1000,
  scheduleWorkflowRedispatch: mock(() => {}),
}));

const { buildCriticUserMessage, critiquePhase } = await import('./phase-critic');
const { applyPhaseCriticGate } = await import('./phase-critic-gate');

describe('critiquePhase — sendAIMessage integration (task 911)', () => {
  beforeEach(() => {
    sendAIMessageMock.mockClear();
    sendAIMessageMock.mockImplementation(async () => ({
      content: '{"pass":true,"severity":0,"issues":[]}',
    }));
    isAnyApiKeyConfiguredMock.mockClear().mockImplementation(async () => true);
    getDefaultProviderMock.mockClear().mockImplementation(async () => 'anthropic');
    auxAiMode = 'api';
  });

  it('includes the acceptance criteria text in the message actually sent to the lens (AC1)', async () => {
    await critiquePhase('research', 'research body', {
      acceptanceCriteria: ['ユニークな受入基準テキストXYZ123'],
    });
    expect(sendAIMessageMock).toHaveBeenCalled();
    const call = sendAIMessageMock.mock.calls[0]?.[0] as {
      messages: { content: string }[];
    };
    expect(call.messages[0]?.content).toContain('ユニークな受入基準テキストXYZ123');
    expect(call.messages[0]?.content).toContain('# 受入基準');
    expect(sendAIMessageMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ model: 'configured-critic-model' }),
    );
  });

  it('AC1 end-to-end: DB-declared acceptance criteria reach the actual message sent to the critic', async () => {
    gateMockPrisma.task.findUnique.mockResolvedValue({
      title: 'タイトル',
      description: '説明文',
      acceptanceCriteria: JSON.stringify(['一意な受入基準ABC999']),
    });

    await applyPhaseCriticGate({
      taskId: 911,
      phase: 'research',
      content: 'research body',
      currentStatus: 'research_done',
    });

    expect(sendAIMessageMock).toHaveBeenCalled();
    const call = sendAIMessageMock.mock.calls[0]?.[0] as { messages: { content: string }[] };
    expect(call.messages[0]?.content).toContain('一意な受入基準ABC999');
    expect(call.messages[0]?.content).toContain('# 受入基準');
  });

  it('reports inputTruncated:true when the artifact exceeds the limit', async () => {
    const result = await critiquePhase('research', 'a'.repeat(45_000));
    expect(result.inputTruncated).toBe(true);
    expect(result.verdict).toBe('unknown');
  });

  // Task 1510 (2026-11-20): research.md was 8,277 chars, over the 8,000 kept
  // as background, while the plan under review (8,466) was shown whole. The
  // pass became unknown, and over 30 days the plan critic recorded no pass
  // at all — 6 of 6 were this. Cut background is noted, not a reason to doubt
  // a verdict on a document the critic read in full.
  it('keeps a pass when only the background was cut, not the artifact', async () => {
    const result = await critiquePhase('plan', 'plan body', {
      referenceArtifact: 'r'.repeat(9000),
    });
    expect(result.inputTruncated).toBe(true);
    expect(result.verdict).toBe('pass');
  });

  it('reports inputTruncated:false when nothing needed truncating', async () => {
    const result = await critiquePhase('research', 'short body');
    expect(result.inputTruncated).toBe(false);
    expect(result.evaluationComplete).toBe(true);
  });

  it('flags a pass that was downgraded only for a cut artifact or requirement', async () => {
    const cut = await critiquePhase('plan', 'a'.repeat(45_000));
    expect(cut.downgradedByTruncation).toBe(true);
    const background = await critiquePhase('plan', 'plan body', {
      referenceArtifact: 'r'.repeat(9000),
    });
    expect(background.downgradedByTruncation).toBe(false);
    const unavailable = await critiquePhase('plan', 'plan body', { unavailable: true });
    expect(unavailable.downgradedByTruncation).toBeUndefined();
  });

  // Real critiquePhase + real gate: only the AI client and the DB are doubles.
  it('returns a truncated plan to the planner when one lens raises a minor issue', async () => {
    gateMockPrisma.task.findUnique.mockResolvedValue({
      title: 'タイトル',
      description: '説明文',
      acceptanceCriteria: null,
    });
    sendAIMessageMock.mockImplementationOnce(async () => ({
      content: '{"pass":false,"severity":20,"issues":["軽い指摘"]}',
    }));
    const result = await applyPhaseCriticGate({
      taskId: 1593,
      phase: 'plan',
      content: 'a'.repeat(45_000),
      currentStatus: 'plan_created',
    });
    expect(sendAIMessageMock).toHaveBeenCalledTimes(3);
    expect(result.bounced).toBe(true);
    expect(result.newStatus).toBe('research_done');
    expect(result.reasons).toEqual(['[feasibility] 軽い指摘']);
  });

  it('does not return a plan when the grounding lookup failed', async () => {
    gateMockPrisma.task.findUnique.mockRejectedValueOnce(new Error('db down'));
    const result = await applyPhaseCriticGate({
      taskId: 1593,
      phase: 'plan',
      content: 'a'.repeat(45_000),
      currentStatus: 'plan_created',
    });
    expect(result.bounced).toBe(false);
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });

  it('does not judge without required grounding after a retrieval failure', async () => {
    const result = await critiquePhase('research', 'artifact', { unavailable: true });
    expect(result.verdict).toBe('unknown');
    expect(result.evaluationComplete).toBe(false);
    expect(sendAIMessageMock).not.toHaveBeenCalled();
  });

  // 2026-09-25 #911: the live evaluation ran from a task worktree whose key
  // lives only in the DB; the key gate returned unknown for every lens without
  // ever calling the model, even though the CLI path needs no key.
  it('still calls the lens in cli mode when no API key is configured', async () => {
    auxAiMode = 'cli';
    isAnyApiKeyConfiguredMock.mockImplementation(async () => false);
    const result = await critiquePhase('research', 'short body');
    expect(sendAIMessageMock).toHaveBeenCalled();
    expect(result.verdict).toBe('pass');
  });

  it('keeps the API-key gate in api mode', async () => {
    auxAiMode = 'api';
    isAnyApiKeyConfiguredMock.mockImplementation(async () => false);
    const result = await critiquePhase('research', 'short body');
    expect(sendAIMessageMock).not.toHaveBeenCalled();
    expect(result.verdict).toBe('unknown');
  });

  for (const position of ['head', 'middle', 'tail']) {
    it(`does not claim full validation with an important ${position} correction in a long brief`, async () => {
      const correction = 'IMPORTANT_CORRECTION_DO_NOT_COMPLETE_UNMET_REQUIREMENTS';
      const padding = 'x'.repeat(4000);
      const taskBrief =
        position === 'head'
          ? correction + padding + padding
          : position === 'tail'
            ? padding + padding + correction
            : padding + correction + padding;
      const { message, truncated } = buildCriticUserMessage('short artifact', { taskBrief });
      expect(truncated).toBe(true);
      expect(message.includes(correction)).toBe(position !== 'middle');
      const result = await critiquePhase('research', 'short artifact', { taskBrief });
      expect(result.verdict).toBe('unknown');
      expect(result.inputTruncated).toBe(true);
    });
  }

  it('does not report complete evaluation when a lens times out', async () => {
    sendAIMessageMock.mockImplementationOnce(async () => {
      throw new Error('Claude CLI timed out');
    });
    const result = await critiquePhase('research', 'short body');
    expect(result.evaluationComplete).toBe(false);
  });
});
