/**
 * Innovation Session テスト
 *
 * セッションはテーマ（プロジェクト）ごとに実行され、生成アイデアは必ず
 * scope='project' + themeId で起票される（グローバル分類は廃止）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface IdeaSubmission {
  title: string;
  content: string;
  source?: string;
  scope?: string;
  themeId?: number;
  [key: string]: unknown;
}

interface MockTheme {
  id: number;
  name: string;
}
interface MockTask {
  title: string;
  description: string;
}

const mockTheme = {
  findMany: mock(() => Promise.resolve([] as MockTheme[])),
};
const mockTask = {
  findMany: mock(() => Promise.resolve([] as MockTask[])),
};
const mockKnowledgeEntry = {
  findMany: mock(() => Promise.resolve([])),
};
const mockPrisma = { theme: mockTheme, task: mockTask, knowledgeEntry: mockKnowledgeEntry };

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  }),
}));
mock.module('../../services/local-llm', () => ({
  getLocalLLMStatus: mock(() => Promise.resolve({ available: false })),
}));
mock.module('../../services/local-llm/local-model-selector', () => ({
  getBestLocalModel: mock(() => Promise.resolve('test-model')),
}));
mock.module('../../services/scheduling/theme-backlog-override-service', () => ({
  getDisabledThemeIds: mock(() => Promise.resolve(new Set<number>())),
}));

const mockSubmitIdea = mock((_idea: IdeaSubmission) => Promise.resolve(99));
mock.module('../../services/memory/idea-box-service', () => ({
  submitIdea: mockSubmitIdea,
}));

interface AIMessageResult {
  content: string;
  tokensUsed: number;
}

const mockSendAIMessage = mock(
  (_args: { messages: Array<{ role: string; content: string }>; model?: string }) =>
    Promise.resolve({
      content: '[{"title":"革新案","content":"異分野からの応用"}]',
      tokensUsed: 80,
    } as AIMessageResult),
);
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const { runInnovationSession } = await import('../../services/memory/innovation-session');

describe('Innovation Session', () => {
  beforeEach(() => {
    mockTheme.findMany.mockReset().mockReturnValue(Promise.resolve([] as MockTheme[]));
    mockTask.findMany.mockReset().mockReturnValue(Promise.resolve([] as MockTask[]));
    mockKnowledgeEntry.findMany.mockReset().mockReturnValue(Promise.resolve([]));
    mockSubmitIdea.mockClear();
    mockSendAIMessage.mockReset().mockReturnValue(
      Promise.resolve({
        content: '[{"title":"革新案","content":"異分野からの応用"}]',
        tokensUsed: 80,
      } as AIMessageResult),
    );
  });

  test('対象プロジェクトが無ければスキップ', async () => {
    const count = await runInnovationSession();
    expect(count).toBe(0);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('信号が全く無い（完了/懸念/バックログ皆無）プロジェクトはスキップ', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 1, name: 'P1' }]));
    mockTask.findMany.mockReturnValue(Promise.resolve([] as MockTask[]));
    mockKnowledgeEntry.findMany.mockReturnValue(Promise.resolve([]));
    const count = await runInnovationSession();
    expect(count).toBe(0);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
  });

  test('完了タスクが無くても、未解決の懸念があればアイデア生成すること', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 5, name: 'P1' }]));
    // No completed tasks / no backlog (both come from the shared task mock).
    mockTask.findMany.mockReturnValue(Promise.resolve([] as MockTask[]));
    // Open concerns present (and reused as existing-ideas list — harmless).
    mockKnowledgeEntry.findMany.mockReturnValue(Promise.resolve([{ title: '未解決の懸念A' }]));
    const count = await runInnovationSession();
    expect(count).toBeGreaterThan(0);
    expect(mockSendAIMessage).toHaveBeenCalled();
  });

  test('完了タスクがあればプロジェクト紐付きでアイデア生成', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 7, name: 'P1' }]));
    mockTask.findMany.mockReturnValue(
      Promise.resolve([{ title: 'task1', description: 'd' }] as MockTask[]),
    );
    const count = await runInnovationSession();
    expect(count).toBeGreaterThan(0);
    expect(mockSubmitIdea).toHaveBeenCalled();
  });

  test('LLMが空配列ならアイデア生成しない', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 1, name: 'P1' }]));
    mockTask.findMany.mockReturnValue(
      Promise.resolve([{ title: 'task1', description: 'd' }] as MockTask[]),
    );
    mockSendAIMessage.mockReturnValue(
      Promise.resolve({ content: '[]', tokensUsed: 10 } as AIMessageResult),
    );
    const count = await runInnovationSession();
    expect(count).toBe(0);
  });

  test('source=innovation_session / scope=project / themeId で保存', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 42, name: 'P1' }]));
    mockTask.findMany.mockReturnValue(
      Promise.resolve([{ title: 'task1', description: 'd' }] as MockTask[]),
    );
    await runInnovationSession();
    const calls = mockSubmitIdea.mock.calls as Array<[IdeaSubmission]>;
    expect(calls.length).toBeGreaterThan(0);
    const call = calls[0][0];
    expect(call.source).toBe('innovation_session');
    expect(call.scope).toBe('project');
    expect(call.themeId).toBe(42);
  });
});

describe('innovation pure helpers', () => {
  test('hasInnovationSignal: 完了・懸念・バックログのいずれかがあれば true', async () => {
    const { hasInnovationSignal } = await import('../../services/memory/innovation-session');
    const empty = { completedTasks: [], openConcerns: [], backlogTasks: [], existingIdeas: [] };
    expect(hasInnovationSignal(empty)).toBe(false);
    expect(hasInnovationSignal({ ...empty, openConcerns: [{ title: 'c' }] })).toBe(true);
    expect(hasInnovationSignal({ ...empty, backlogTasks: [{ title: 't' }] })).toBe(true);
    expect(
      hasInnovationSignal({ ...empty, completedTasks: [{ title: 'd', description: null }] }),
    ).toBe(true);
    // existingIdeas alone is NOT a signal (it's only for dedup).
    expect(hasInnovationSignal({ ...empty, existingIdeas: [{ title: 'i' }] })).toBe(false);
  });

  test('buildInnovationPrompt: 懸念・バックログ・既存アイデアを本文へ埋め込むこと', async () => {
    const { buildInnovationPrompt } = await import('../../services/memory/innovation-session');
    const prompt = buildInnovationPrompt('MyProject', {
      completedTasks: [{ title: '完了タスクX', description: null }],
      openConcerns: [{ title: '懸念Y' }],
      backlogTasks: [{ title: 'バックログZ' }],
      existingIdeas: [{ title: '既存アイデアW' }],
    });
    expect(prompt).toContain('MyProject');
    expect(prompt).toContain('完了タスクX');
    expect(prompt).toContain('懸念Y');
    expect(prompt).toContain('バックログZ');
    expect(prompt).toContain('既存アイデアW');
    // Frames concerns as opportunity sources.
    expect(prompt).toContain('課題→機会の転換');
    // R3: verbalized sampling + persona conditioning are baked into the prompt.
    expect(prompt).toContain('typicality');
    expect(prompt).toContain('エンドユーザー');
  });

  test('buildInnovationPrompt: 指定ペルソナが本文に入ること', async () => {
    const { buildInnovationPrompt, IDEATION_PERSONAS } =
      await import('../../services/memory/innovation-session');
    const empty = { completedTasks: [], openConcerns: [], backlogTasks: [], existingIdeas: [] };
    const prompt = buildInnovationPrompt('P', empty, IDEATION_PERSONAS[2]);
    expect(prompt).toContain('セキュリティ監査者');
  });

  test('pickPersona: シードで決定的に回転する', async () => {
    const { pickPersona, IDEATION_PERSONAS } =
      await import('../../services/memory/innovation-session');
    expect(pickPersona(0)).toBe(IDEATION_PERSONAS[0]);
    expect(pickPersona(IDEATION_PERSONAS.length)).toBe(IDEATION_PERSONAS[0]);
    expect(pickPersona(3)).toBe(pickPersona(3 + IDEATION_PERSONAS.length));
  });

  test('selectTailCandidates: 低typicality優先で採用し、欠損は0.5扱い', async () => {
    const { selectTailCandidates } = await import('../../services/memory/innovation-session');
    const picked = selectTailCandidates(
      [
        { title: '定番', content: 'c', typicality: 0.9 },
        { title: '独創', content: 'c', typicality: 0.1 },
        { title: '中庸', content: 'c' }, // → 0.5
        { title: '', content: 'c', typicality: 0.0 }, // invalid: title空
      ],
      2,
    );
    expect(picked.map((p) => p.title)).toEqual(['独創', '中庸']);
  });
});
