import { useExecutionStateStore } from '../execution-state-store';

describe('executionStateStore', () => {
  beforeEach(() => {
    useExecutionStateStore.setState({ executingTasks: new Map() });
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
});
