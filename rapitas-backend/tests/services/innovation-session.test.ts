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

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
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

const mockSubmitIdea = mock((idea: IdeaSubmission) => Promise.resolve(99));
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

  test('完了タスクの無いプロジェクトはスキップ', async () => {
    mockTheme.findMany.mockReturnValue(Promise.resolve([{ id: 1, name: 'P1' }]));
    mockTask.findMany.mockReturnValue(Promise.resolve([] as MockTask[]));
    const count = await runInnovationSession();
    expect(count).toBe(0);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
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
