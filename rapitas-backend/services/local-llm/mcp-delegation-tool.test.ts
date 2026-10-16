import { describe, test, expect, mock } from 'bun:test';

const mockSendAIMessage = mock(() => Promise.resolve({ content: 'llm output', tokensUsed: 5 }));
mock.module('../../utils/ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
}));

const mockExecuteWithTeacherStudent = mock(() =>
  Promise.resolve({ output: 'evaluated output', source: 'student' as const, score: 0.9 }),
);
mock.module('./teacher-student', () => ({
  executeWithTeacherStudent: mockExecuteWithTeacherStudent,
}));

mock.module('../../config', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { delegateToLocalLLM, getAvailableDelegationTasks } = await import('./mcp-delegation-tool');

describe('delegateToLocalLLM', () => {
  test('throws for an unknown task type', async () => {
    await expect(delegateToLocalLLM({ taskType: 'bogus' as never, input: 'x' })).rejects.toThrow(
      'Unknown delegation task type',
    );
  });

  test('calls sendAIMessage with ollama + RAG for a direct (non-evaluated) delegation', async () => {
    mockSendAIMessage.mockClear();
    const result = await delegateToLocalLLM({ taskType: 'summarize', input: 'long text here' });

    expect(result.output).toBe('llm output');
    expect(result.source).toBe('local-llm');
    expect(result.taskType).toBe('summarize');
    expect(typeof result.processingTimeMs).toBe('number');
    expect(mockSendAIMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'ollama',
        enableRAG: true,
        maxTokens: 256,
      }),
    );
  });

  test('passes themeId through as ragThemeId', async () => {
    mockSendAIMessage.mockClear();
    await delegateToLocalLLM({ taskType: 'translate', input: 'hi', themeId: 99 });
    expect(mockSendAIMessage).toHaveBeenCalledWith(expect.objectContaining({ ragThemeId: 99 }));
  });

  test('uses the Teacher-Student loop when evaluate is true', async () => {
    mockExecuteWithTeacherStudent.mockClear();
    mockSendAIMessage.mockClear();
    const result = await delegateToLocalLLM({
      taskType: 'commit-message',
      input: 'diff text',
      evaluate: true,
    });

    expect(mockExecuteWithTeacherStudent).toHaveBeenCalledTimes(1);
    expect(mockSendAIMessage).not.toHaveBeenCalled();
    expect(result.output).toBe('evaluated output');
    expect(result.source).toBe('local-llm'); // 'student' is mapped to 'local-llm'
    expect(result.score).toBe(0.9);
  });

  test('maps a non-student Teacher-Student source through unchanged', async () => {
    mockExecuteWithTeacherStudent.mockResolvedValueOnce({
      output: 'corrected',
      source: 'teacher-corrected',
      score: 0.6,
    });
    const result = await delegateToLocalLLM({
      taskType: 'branch-name',
      input: 'x',
      evaluate: true,
    });
    expect(result.source).toBe('teacher-corrected');
  });

  test('propagates and logs an error from sendAIMessage', async () => {
    mockSendAIMessage.mockImplementationOnce(() => Promise.reject(new Error('llm down')));
    await expect(delegateToLocalLLM({ taskType: 'extract-keywords', input: 'x' })).rejects.toThrow(
      'llm down',
    );
  });

  test('uses each task type config (systemPrompt/maxTokens) correctly', async () => {
    mockSendAIMessage.mockClear();
    await delegateToLocalLLM({ taskType: 'classify-task', input: 'x' });
    expect(mockSendAIMessage).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 20 }));
  });
});

describe('getAvailableDelegationTasks', () => {
  test('returns all 7 configured task types with metadata', () => {
    const tasks = getAvailableDelegationTasks();
    expect(tasks).toHaveLength(7);
    const types = tasks.map((t) => t.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'summarize',
        'commit-message',
        'branch-name',
        'translate',
        'extract-keywords',
        'format-code-comment',
        'classify-task',
      ]),
    );
    for (const t of tasks) {
      expect(typeof t.description).toBe('string');
      expect(typeof t.maxTokens).toBe('number');
    }
  });
});
