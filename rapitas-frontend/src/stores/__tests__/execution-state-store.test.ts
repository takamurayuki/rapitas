import { useExecutionStateStore, type LiveQuestion } from '../execution-state-store';

describe('executionStateStore', () => {
  beforeEach(() => {
    useExecutionStateStore.setState({
      executingTasks: new Map(),
      loadingTaskIds: new Set(),
      liveQuestions: new Map(),
      answeredAt: new Map(),
    });
  });

  it('should have empty executingTasks initially', () => {
    const state = useExecutionStateStore.getState();
    expect(state.executingTasks.size).toBe(0);
  });

  describe('setExecutingTask', () => {
    it('should add a new executing task', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'running',
      });
      const tasks = useExecutionStateStore.getState().executingTasks;
      expect(tasks.size).toBe(1);
      expect(tasks.get(1)).toEqual({ taskId: 1, status: 'running' });
    });

    it('should update an existing task status', () => {
      const store = useExecutionStateStore.getState();
      store.setExecutingTask({ taskId: 1, status: 'running' });
      store.setExecutingTask({ taskId: 1, status: 'waiting_for_input' });
      const task = useExecutionStateStore.getState().executingTasks.get(1);
      expect(task?.status).toBe('waiting_for_input');
    });

    it('should not create a new Map reference if task is unchanged', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        sessionId: 10,
        status: 'running',
      });
      const mapBefore = useExecutionStateStore.getState().executingTasks;
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        sessionId: 10,
        status: 'running',
      });
      const mapAfter = useExecutionStateStore.getState().executingTasks;
      expect(mapBefore).toBe(mapAfter);
    });

    it('cumulativeActiveMs の変化はデデュープをすり抜けず反映される（task #560）', () => {
      const store = useExecutionStateStore.getState();
      store.setExecutingTask({ taskId: 1, status: 'running', cumulativeActiveMs: 0 });
      // フェーズ完了で累積が増えたポーリング結果
      store.setExecutingTask({ taskId: 1, status: 'running', cumulativeActiveMs: 600_000 });
      expect(useExecutionStateStore.getState().getExecutingTaskActiveMs(1)).toBe(600_000);
    });
  });

  describe('getExecutingTaskActiveMs', () => {
    it('未登録タスク・未設定フィールドは 0 を返す', () => {
      const store = useExecutionStateStore.getState();
      expect(store.getExecutingTaskActiveMs(999)).toBe(0);
      store.setExecutingTask({ taskId: 1, status: 'running' });
      expect(useExecutionStateStore.getState().getExecutingTaskActiveMs(1)).toBe(0);
    });
  });

  describe('removeExecutingTask', () => {
    it('should remove a task by id', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'running',
      });
      useExecutionStateStore.getState().removeExecutingTask(1);
      expect(useExecutionStateStore.getState().executingTasks.size).toBe(0);
    });

    it('should not change state when removing non-existent task', () => {
      const stateBefore = useExecutionStateStore.getState().executingTasks;
      useExecutionStateStore.getState().removeExecutingTask(999);
      const stateAfter = useExecutionStateStore.getState().executingTasks;
      expect(stateBefore).toBe(stateAfter);
    });
  });

  describe('clearAll', () => {
    it('should clear all executing tasks', () => {
      const store = useExecutionStateStore.getState();
      store.setExecutingTask({ taskId: 1, status: 'running' });
      store.setExecutingTask({ taskId: 2, status: 'completed' });
      store.clearAll();
      expect(useExecutionStateStore.getState().executingTasks.size).toBe(0);
    });
  });

  describe('isTaskExecuting', () => {
    it('should return true for running tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'running',
      });
      expect(useExecutionStateStore.getState().isTaskExecuting(1)).toBe(true);
    });

    it('should return true for waiting_for_input tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'waiting_for_input',
      });
      expect(useExecutionStateStore.getState().isTaskExecuting(1)).toBe(true);
    });

    it('should return false for completed tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'completed',
      });
      expect(useExecutionStateStore.getState().isTaskExecuting(1)).toBe(false);
    });

    it('should return false for failed tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'failed',
      });
      expect(useExecutionStateStore.getState().isTaskExecuting(1)).toBe(false);
    });

    it('should return false for non-existent tasks', () => {
      expect(useExecutionStateStore.getState().isTaskExecuting(999)).toBe(false);
    });
  });

  describe('getExecutingTaskStatus', () => {
    it('should return "running" for running tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'running',
      });
      expect(useExecutionStateStore.getState().getExecutingTaskStatus(1)).toBe('running');
    });

    it('should return "waiting_for_input" for waiting tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'waiting_for_input',
      });
      expect(useExecutionStateStore.getState().getExecutingTaskStatus(1)).toBe('waiting_for_input');
    });

    it('should return null for completed tasks', () => {
      useExecutionStateStore.getState().setExecutingTask({
        taskId: 1,
        status: 'completed',
      });
      expect(useExecutionStateStore.getState().getExecutingTaskStatus(1)).toBe(null);
    });

    it('should return null for non-existent tasks', () => {
      expect(useExecutionStateStore.getState().getExecutingTaskStatus(999)).toBe(null);
    });
  });

  describe('getExecutingTaskStartedAt', () => {
    it('returns the startedAt timestamp of a running task', () => {
      useExecutionStateStore
        .getState()
        .setExecutingTask({ taskId: 1, status: 'running', startedAt: '2026-01-01T00:00:00Z' });
      expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(1)).toBe(
        '2026-01-01T00:00:00Z',
      );
    });

    it('returns null when the task has no startedAt', () => {
      useExecutionStateStore.getState().setExecutingTask({ taskId: 1, status: 'running' });
      expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(1)).toBeNull();
    });

    it('returns null for a non-existent task', () => {
      expect(useExecutionStateStore.getState().getExecutingTaskStartedAt(999)).toBeNull();
    });
  });

  describe('setTaskLoading / setTaskLoaded / isTaskLoading', () => {
    it('marks a task as loading', () => {
      useExecutionStateStore.getState().setTaskLoading(1);
      expect(useExecutionStateStore.getState().isTaskLoading(1)).toBe(true);
    });

    it('marking an already-loading task loading again keeps the same Set reference', () => {
      useExecutionStateStore.getState().setTaskLoading(1);
      const before = useExecutionStateStore.getState().loadingTaskIds;
      useExecutionStateStore.getState().setTaskLoading(1);
      expect(useExecutionStateStore.getState().loadingTaskIds).toBe(before);
    });

    it('clears loading state via setTaskLoaded', () => {
      useExecutionStateStore.getState().setTaskLoading(1);
      useExecutionStateStore.getState().setTaskLoaded(1);
      expect(useExecutionStateStore.getState().isTaskLoading(1)).toBe(false);
    });

    it('setTaskLoaded on a not-loading task keeps the same Set reference', () => {
      const before = useExecutionStateStore.getState().loadingTaskIds;
      useExecutionStateStore.getState().setTaskLoaded(1);
      expect(useExecutionStateStore.getState().loadingTaskIds).toBe(before);
    });

    it('returns false for a task never marked as loading', () => {
      expect(useExecutionStateStore.getState().isTaskLoading(42)).toBe(false);
    });
  });

  describe('setLiveQuestion / getLiveQuestion', () => {
    const question: LiveQuestion = {
      taskId: 1,
      text: 'Continue?',
      options: ['はい', 'いいえ'],
      sessionId: 10,
    };

    it('publishes a new live question', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toEqual(question);
    });

    it('returns null when no question is published for the task', () => {
      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toBeNull();
    });

    it('clearing an already-null question is a no-op (same Map reference)', () => {
      const before = useExecutionStateStore.getState().liveQuestions;
      useExecutionStateStore.getState().setLiveQuestion(1, null);
      expect(useExecutionStateStore.getState().liveQuestions).toBe(before);
    });

    it('publishing an identical question again does not create a new Map', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      const before = useExecutionStateStore.getState().liveQuestions;
      useExecutionStateStore.getState().setLiveQuestion(1, { ...question });
      expect(useExecutionStateStore.getState().liveQuestions).toBe(before);
    });

    it('publishing a question with different text replaces the entry', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore.getState().setLiveQuestion(1, { ...question, text: 'Changed?' });
      expect(useExecutionStateStore.getState().getLiveQuestion(1)?.text).toBe('Changed?');
    });

    it('publishing a question with different options replaces the entry', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore
        .getState()
        .setLiveQuestion(1, { ...question, options: ['はい', 'いいえ', '保留'] });
      expect(useExecutionStateStore.getState().getLiveQuestion(1)?.options).toEqual([
        'はい',
        'いいえ',
        '保留',
      ]);
    });

    it('clearing an existing question removes it', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore.getState().setLiveQuestion(1, null);
      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toBeNull();
    });
  });

  describe('markQuestionAnswered', () => {
    const question: LiveQuestion = {
      taskId: 1,
      text: 'Continue?',
      options: ['はい', 'いいえ'],
    };

    it('clears the live question for the task', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore.getState().markQuestionAnswered(1);
      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toBeNull();
    });

    it('suppresses re-publishing the same-shaped question within the grace window', () => {
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore.getState().markQuestionAnswered(1);

      // Poller re-publishes the same question shortly after (backend hasn't
      // cleared waiting_for_input yet) — must NOT flicker back.
      useExecutionStateStore.getState().setLiveQuestion(1, question);

      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toBeNull();
    });

    it('allows re-publishing after the grace window elapses', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(0);
        useExecutionStateStore.getState().setLiveQuestion(1, question);
        useExecutionStateStore.getState().markQuestionAnswered(1);

        vi.setSystemTime(9000); // past ANSWER_GRACE_MS (8000ms)
        useExecutionStateStore.getState().setLiveQuestion(1, question);

        expect(useExecutionStateStore.getState().getLiveQuestion(1)).toEqual(question);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not affect other tasks’ live questions', () => {
      const q2: LiveQuestion = { taskId: 2, text: 'Other?', options: [] };
      useExecutionStateStore.getState().setLiveQuestion(1, question);
      useExecutionStateStore.getState().setLiveQuestion(2, q2);

      useExecutionStateStore.getState().markQuestionAnswered(1);

      expect(useExecutionStateStore.getState().getLiveQuestion(1)).toBeNull();
      expect(useExecutionStateStore.getState().getLiveQuestion(2)).toEqual(q2);
    });
  });
});
