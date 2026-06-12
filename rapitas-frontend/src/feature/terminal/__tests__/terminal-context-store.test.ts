import { useTerminalContextStore, getTerminalContext } from '../terminal-context-store';

describe('terminalContextStore', () => {
  beforeEach(() => {
    useTerminalContextStore.setState({ cwd: null, title: null });
  });

  it('defaults to an empty context', () => {
    expect(getTerminalContext()).toEqual({ cwd: null, title: null });
  });

  it('setTerminalContext stores cwd and title', () => {
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/x', title: 'X' });
    expect(getTerminalContext()).toEqual({ cwd: '/proj/x', title: 'X' });
  });

  it('normalizes an omitted title to null', () => {
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/y' });
    expect(getTerminalContext()).toEqual({ cwd: '/proj/y', title: null });
  });

  it('clearing the context resets cwd to null', () => {
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/z', title: 'Z' });
    useTerminalContextStore.getState().setTerminalContext({ cwd: null });
    expect(getTerminalContext().cwd).toBeNull();
  });
});
