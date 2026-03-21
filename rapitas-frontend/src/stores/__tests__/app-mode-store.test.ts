import { useAppModeStore } from '../app-mode-store';

describe('appModeStore', () => {
  beforeEach(() => {
    useAppModeStore.setState({ mode: 'all' });
  });

  it('should have initial mode as "all"', () => {
    const state = useAppModeStore.getState();
    expect(state.mode).toBe('all');
  });

  it('should set mode to "development"', () => {
    useAppModeStore.getState().setMode('development');
    expect(useAppModeStore.getState().mode).toBe('development');
  });

  it('should set mode to "learning"', () => {
    useAppModeStore.getState().setMode('learning');
    expect(useAppModeStore.getState().mode).toBe('learning');
  });

  it('should set mode back to "all"', () => {
    useAppModeStore.getState().setMode('development');
    useAppModeStore.getState().setMode('all');
    expect(useAppModeStore.getState().mode).toBe('all');
  });
});
