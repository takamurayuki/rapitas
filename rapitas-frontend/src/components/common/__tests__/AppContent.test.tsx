/**
 * AppContent — terminal split-mode padding
 *
 * AppContent reserves space (padding-left/right) for the integrated terminal
 * when it's docked in split mode, so the fixed-position panel is genuinely
 * side-by-side with the page instead of covering it. Overlay mode (the
 * default) must leave layout untouched.
 */
import { render } from '@testing-library/react';
import AppContent from '../AppContent';
import { useNavStore } from '@/stores/nav-store';
import { useTerminalStore } from '@/feature/terminal/terminal-store';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';

function makeTab() {
  return {
    id: 't1',
    title: 'Terminal 1',
    direction: 'row' as const,
    panes: [{ id: 'p1' }],
    activePaneId: 'p1',
  };
}

describe('AppContent', () => {
  beforeEach(() => {
    useNavStore.setState({ isMenuPinned: false });
    useTerminalStore.setState({
      isOpen: false,
      displayMode: 'overlay',
      dockSide: 'right',
      splitWidthPercent: 50,
      tabs: [],
      activeTabId: null,
    });
    useTaskDetailVisibilityStore.setState({
      isTaskDetailVisible: false,
      displayMode: 'overlay',
      dockSide: 'right',
    });
  });

  it('applies no padding when the terminal is closed', () => {
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('');
    expect(outer.style.paddingLeft).toBe('');
  });

  it('applies no padding in overlay mode even when open', () => {
    useTerminalStore.setState({ isOpen: true, tabs: [makeTab()], displayMode: 'overlay' });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('');
    expect(outer.style.paddingLeft).toBe('');
  });

  it('reserves right padding when split-docked right and open', () => {
    useTerminalStore.setState({
      isOpen: true,
      tabs: [makeTab()],
      displayMode: 'split',
      dockSide: 'right',
      splitWidthPercent: 40,
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('40vw');
    expect(outer.style.paddingLeft).toBe('');
  });

  it('reserves left padding when split-docked left and open', () => {
    useTerminalStore.setState({
      isOpen: true,
      tabs: [makeTab()],
      displayMode: 'split',
      dockSide: 'left',
      splitWidthPercent: 60,
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingLeft).toBe('60vw');
    expect(outer.style.paddingRight).toBe('');
  });

  it('reserves right padding for the task detail panel in split mode', () => {
    useTaskDetailVisibilityStore.setState({
      isTaskDetailVisible: true,
      displayMode: 'split',
      dockSide: 'right',
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('50vw');
    expect(outer.style.paddingLeft).toBe('');
  });

  it('applies no padding for the task detail panel in overlay mode', () => {
    useTaskDetailVisibilityStore.setState({
      isTaskDetailVisible: true,
      displayMode: 'overlay',
      dockSide: 'right',
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('');
  });

  it('sums terminal and task detail widths when both split-dock the same edge', () => {
    useTerminalStore.setState({
      isOpen: true,
      tabs: [makeTab()],
      displayMode: 'split',
      dockSide: 'right',
      splitWidthPercent: 30,
    });
    useTaskDetailVisibilityStore.setState({
      isTaskDetailVisible: true,
      displayMode: 'split',
      dockSide: 'right',
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('80vw');
  });

  it('applies no padding in split mode when closed', () => {
    useTerminalStore.setState({
      isOpen: false,
      tabs: [makeTab()],
      displayMode: 'split',
      dockSide: 'right',
    });
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    const outer = container.firstChild as HTMLElement;
    expect(outer.style.paddingRight).toBe('');
  });
});
