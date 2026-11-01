/**
 * TabStrip.test
 *
 * Browser-style tab groups, end to end over the real stores: filing a tab
 * into a group, collapsing the group to its heading, releasing it, and
 * deleting it from the library without closing anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { TabStrip } from './TabStrip';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const view = () => useLinkViewStore.getState();
const library = () => useLinkLibraryStore.getState();

beforeEach(() => {
  useLinkViewStore.setState({
    tabs: [],
    activeId: null,
    isOpen: false,
    view: 'page',
    collapsedGroupIds: [],
  });
  useLinkLibraryStore.setState({ groups: [], favourites: [] });
});

/** Two open tabs, the first filed under a group called "Design". */
function withAGroup() {
  view().openLink('https://a.example');
  view().openLink('https://b.example');
  const [a] = view().tabs;
  const groupId = library().addGroup('Design');
  view().setTabGroup(a.id, groupId);
  return { groupId, tabId: a.id };
}

/** Render the strip against whatever is in the stores right now. */
function show() {
  const tabs = view().tabs;
  return render(
    <TabStrip
      tabs={tabs}
      activeId={view().activeId ?? ''}
      onActivate={vi.fn()}
      onCloseTab={(id) => view().closeTab(id)}
      onNewTab={vi.fn()}
    />,
  );
}

describe('drawing a group', () => {
  it('shows the group heading and its member', () => {
    withAGroup();
    show();
    expect(screen.getByText('Design')).toBeTruthy();
    expect(screen.getByText('a.example')).toBeTruthy();
  });

  it('hides the members when the heading is clicked, and shows them again', () => {
    withAGroup();
    const { rerender } = show();

    fireEvent.click(screen.getByText('Design'));
    expect(view().collapsedGroupIds).toHaveLength(1);

    rerender(
      <TabStrip
        tabs={view().tabs}
        activeId={view().activeId ?? ''}
        onActivate={vi.fn()}
        onCloseTab={vi.fn()}
        onNewTab={vi.fn()}
      />,
    );
    expect(screen.queryByText('a.example')).toBeNull();
    // The ungrouped tab is unaffected.
    expect(screen.getByText('b.example')).toBeTruthy();
  });

  it('leaves an ungrouped tab outside the group', () => {
    withAGroup();
    show();
    expect(screen.getByText('b.example')).toBeTruthy();
  });
});

describe('filing a tab from its menu', () => {
  it('opens the menu on a right-click', () => {
    view().openLink('https://a.example');
    show();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(screen.getByText('a.example'));
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('starts a new group holding that tab', () => {
    view().openLink('https://a.example');
    show();
    fireEvent.contextMenu(screen.getByText('a.example'));
    fireEvent.click(screen.getByText('addToNewGroup'));

    expect(library().groups).toHaveLength(1);
    expect(view().tabs[0].groupId).toBe(library().groups[0].id);
  });

  it('offers the groups that already exist, by name', () => {
    const { groupId } = withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('b.example'));
    fireEvent.click(within(screen.getByRole('menu')).getByText('Design'));
    expect(view().tabs[1].groupId).toBe(groupId);
  });

  // The group it is already in is not worth offering.
  it('does not offer the group the tab is already in', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('a.example'));
    expect(within(screen.getByRole('menu')).queryByText('Design')).toBeNull();
  });

  it('takes a tab out of its group', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('a.example'));
    fireEvent.click(screen.getByText('removeFromGroup'));
    expect(view().tabs[0].groupId).toBeNull();
  });

  it('offers no way out for a tab that is not in one', () => {
    view().openLink('https://a.example');
    show();
    fireEvent.contextMenu(screen.getByText('a.example'));
    expect(screen.queryByText('removeFromGroup')).toBeNull();
  });
});

describe('the group heading menu', () => {
  it('releases the tabs without closing them', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('ungroup'));

    expect(view().tabs).toHaveLength(2);
    expect(view().tabs.every((t) => !t.groupId)).toBe(true);
    // Releasing is not deleting: the group is still in the library.
    expect(library().groups).toHaveLength(1);
  });

  it('closes every tab in the group', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('closeGroup'));
    expect(view().tabs.map((t) => t.url)).toEqual(['https://b.example']);
  });

  // The defect this guards: deleting the group from the library leaves the
  // tabs pointing at an id nothing resolves.
  it('deletes the group and releases the tabs that were in it', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('deleteGroup'));

    expect(library().groups).toEqual([]);
    expect(view().tabs).toHaveLength(2);
    expect(view().tabs.every((t) => !t.groupId)).toBe(true);
  });

  it('opens the name and colour panel', () => {
    withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('editGroup'));
    expect(screen.getByLabelText('groupNamePlaceholder')).toBeTruthy();
  });

  it('renames the group as it is typed', () => {
    const { groupId } = withAGroup();
    show();
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('editGroup'));
    fireEvent.change(screen.getByLabelText('groupNamePlaceholder'), { target: { value: 'Docs' } });
    expect(library().groups.find((g) => g.id === groupId)?.name).toBe('Docs');
  });

  it('recolours the group from a swatch', () => {
    const { groupId } = withAGroup();
    show();
    const before = library().groups[0].color;
    fireEvent.contextMenu(screen.getByText('Design'));
    fireEvent.click(screen.getByText('editGroup'));

    const swatch = screen
      .getAllByRole('button')
      .find(
        (b) =>
          b.getAttribute('aria-label')?.startsWith('#') && b.getAttribute('aria-label') !== before,
      );
    fireEvent.click(swatch as HTMLElement);
    expect(library().groups.find((g) => g.id === groupId)?.color).not.toBe(before);
  });
});
