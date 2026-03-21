import { useUIModeStore } from '../ui-mode-store';

describe('uiModeStore', () => {
  beforeEach(() => {
    useUIModeStore.setState({ currentMode: 'task' });
  });

  it('should have initial mode as "task"', () => {
    expect(useUIModeStore.getState().currentMode).toBe('task');
  });

  it('should set mode to "ai"', () => {
    useUIModeStore.getState().setMode('ai');
    expect(useUIModeStore.getState().currentMode).toBe('ai');
  });

  it('should set mode to "note"', () => {
    useUIModeStore.getState().setMode('note');
    expect(useUIModeStore.getState().currentMode).toBe('note');
  });

  it('should set mode back to "task"', () => {
    useUIModeStore.getState().setMode('ai');
    useUIModeStore.getState().setMode('task');
    expect(useUIModeStore.getState().currentMode).toBe('task');
  });
});
