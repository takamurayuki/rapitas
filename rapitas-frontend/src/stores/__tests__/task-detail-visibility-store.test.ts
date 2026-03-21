import { useTaskDetailVisibilityStore } from '../task-detail-visibility-store';

describe('taskDetailVisibilityStore', () => {
  beforeEach(() => {
    useTaskDetailVisibilityStore.setState({ isTaskDetailVisible: false });
  });

  it('should have isTaskDetailVisible as false initially', () => {
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(
      false,
    );
  });

  it('showTaskDetail should set isTaskDetailVisible to true', () => {
    useTaskDetailVisibilityStore.getState().showTaskDetail();
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(
      true,
    );
  });

  it('hideTaskDetail should set isTaskDetailVisible to false', () => {
    useTaskDetailVisibilityStore.getState().showTaskDetail();
    useTaskDetailVisibilityStore.getState().hideTaskDetail();
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(
      false,
    );
  });
});
