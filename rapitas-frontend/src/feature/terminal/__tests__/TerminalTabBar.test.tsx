/**
 * TerminalTabBar — display-mode toggle and dock-side swap
 *
 * The panel-control buttons for switching between overlay/split mode and,
 * while split, swapping which edge it's docked to (see terminal-store's
 * displayMode/dockSide).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import TerminalTabBar from '../TerminalTabBar';
import { useTerminalStore } from '../terminal-store';
import type { TabState } from '../terminal.types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function makeTab(id: string): TabState {
  return {
    id,
    title: `Terminal ${id}`,
    direction: 'row',
    panes: [{ id: `${id}-pane` }],
    activePaneId: `${id}-pane`,
  };
}

function resetStore() {
  const tab = makeTab('t1');
  useTerminalStore.setState({
    isOpen: true,
    displayMode: 'overlay',
    dockSide: 'right',
    splitWidthPercent: 50,
    tabs: [tab],
    activeTabId: tab.id,
  });
}

describe('TerminalTabBar — display mode / dock side', () => {
  beforeEach(resetStore);

  it('hides the dock-side swap button in overlay mode', () => {
    render(<TerminalTabBar />);
    expect(screen.queryByLabelText('swapDockSideAria')).not.toBeInTheDocument();
  });

  it('switching to split mode reveals the dock-side swap button', () => {
    render(<TerminalTabBar />);
    fireEvent.click(screen.getByLabelText('switchToSplitMode'));
    expect(useTerminalStore.getState().displayMode).toBe('split');
  });

  it('the display-mode button toggles split back to overlay', () => {
    useTerminalStore.setState({ displayMode: 'split' });
    render(<TerminalTabBar />);
    fireEvent.click(screen.getByLabelText('switchToOverlayMode'));
    expect(useTerminalStore.getState().displayMode).toBe('overlay');
  });

  it('the dock-side swap button flips right <-> left', () => {
    useTerminalStore.setState({ displayMode: 'split', dockSide: 'right' });
    render(<TerminalTabBar />);
    fireEvent.click(screen.getByLabelText('swapDockSideAria'));
    expect(useTerminalStore.getState().dockSide).toBe('left');
  });
});
