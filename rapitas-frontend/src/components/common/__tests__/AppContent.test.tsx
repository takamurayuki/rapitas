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
import { useLinkViewStore } from '@/stores/link-view-store';

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
    useLinkViewStore.setState({
      isOpen: false,
      tabs: [],
      activeId: null,
      view: 'page',
      collapsedGroupIds: [],
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

/**
 * The link pane reserves page width so it sits beside the content rather
 * than over it. Reported 2026-10-19: closing the pane left the content
 * squeezed against the left edge — the reservation keyed on there being a
 * TAB, and hiding the pane deliberately keeps the tabs so Ctrl+B can bring
 * them back. What the page has to follow is whether the pane is on screen.
 */
describe('AppContent — link pane', () => {
  const render1 = () => {
    const { container } = render(
      <AppContent>
        <div>content</div>
      </AppContent>,
    );
    return container.firstChild as HTMLElement;
  };

  const openPaneWithATab = () =>
    useLinkViewStore.setState({
      isOpen: true,
      tabs: [{ id: 't1', url: 'https://a.example' }],
      activeId: 't1',
      view: 'page',
    });

  it('reserves room while the pane is showing a page', () => {
    openPaneWithATab();
    expect(render1().style.paddingRight).not.toBe('');
  });

  // The defect: hidden pane, tabs kept, page still padded.
  it('gives the room back when the pane is hidden', () => {
    openPaneWithATab();
    useLinkViewStore.setState({ isOpen: false });
    const outer = render1();
    expect(outer.style.paddingRight).toBe('');
    expect(outer.style.paddingLeft).toBe('');
  });

  it('keeps the tabs while hidden, and reserves again on return', () => {
    openPaneWithATab();
    useLinkViewStore.setState({ isOpen: false });
    expect(render1().style.paddingRight).toBe('');

    useLinkViewStore.setState({ isOpen: true });
    expect(useLinkViewStore.getState().tabs).toHaveLength(1);
    expect(render1().style.paddingRight).not.toBe('');
  });

  // The mirror of the same mistake: Ctrl+B on an empty pane opens the
  // saved-pages library, which occupies the pane and so needs the room too.
  it('reserves room for the library, which has no tab at all', () => {
    useLinkViewStore.setState({ isOpen: true, tabs: [], activeId: null, view: 'library' });
    expect(render1().style.paddingRight).not.toBe('');
  });

  it('reserves on the left when the task panel holds the right', () => {
    useTaskDetailVisibilityStore.setState({ isTaskDetailVisible: true, dockSide: 'right' });
    openPaneWithATab();
    const outer = render1();
    expect(outer.style.paddingLeft).not.toBe('');
  });
});
