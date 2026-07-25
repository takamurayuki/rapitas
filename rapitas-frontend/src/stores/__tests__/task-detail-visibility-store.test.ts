import { useTaskDetailVisibilityStore } from '../task-detail-visibility-store';

describe('taskDetailVisibilityStore', () => {
  beforeEach(() => {
    useTaskDetailVisibilityStore.setState({ isTaskDetailVisible: false, dockSide: 'right' });
  });

  it('should have isTaskDetailVisible as false initially', () => {
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(false);
  });

  it('showTaskDetail should set isTaskDetailVisible to true', () => {
    useTaskDetailVisibilityStore.getState().showTaskDetail();
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(true);
  });

  it('hideTaskDetail should set isTaskDetailVisible to false', () => {
    useTaskDetailVisibilityStore.getState().showTaskDetail();
    useTaskDetailVisibilityStore.getState().hideTaskDetail();
    expect(useTaskDetailVisibilityStore.getState().isTaskDetailVisible).toBe(false);
  });

  describe('dockSide', () => {
    it('defaults to right', () => {
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('right');
    });

    it('setDockSide sets an explicit side', () => {
      useTaskDetailVisibilityStore.getState().setDockSide('left');
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('left');
      useTaskDetailVisibilityStore.getState().setDockSide('right');
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('right');
    });

    it('toggleDockSide flips right <-> left', () => {
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('right');
      useTaskDetailVisibilityStore.getState().toggleDockSide();
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('left');
      useTaskDetailVisibilityStore.getState().toggleDockSide();
      expect(useTaskDetailVisibilityStore.getState().dockSide).toBe('right');
    });
  });
});
