import { render } from '@testing-library/react';
import { WorkflowTabBar } from '../WorkflowTabBar';
import type { WorkflowTab } from '../workflow-viewer-utils';

// The mock echoes the translation key back; assertions target key paths, not
// translated copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const RESEARCH_TAB: WorkflowTab = {
  id: 'research',
  label: 'Research',
  icon: () => null,
  emptyText: 'empty',
} as unknown as WorkflowTab;

/**
 * The phase-critic gate archives a rejected research.md/plan.md and rolls the
 * status back, so the tab briefly reports !hasContent while it regenerates.
 * Without a distinct indicator this reads identically to "never produced" —
 * these tests pin the two states apart.
 */
describe('WorkflowTabBar regenerating indicator', () => {
  it('shows nothing on an empty tab when it is not the regenerating one', () => {
    const { queryByText } = render(
      <WorkflowTabBar
        tabs={[RESEARCH_TAB]}
        activeTab="research"
        tabStatus={{ research: false, question: false, plan: false, verify: false }}
        effectiveStatus="draft"
        onTabChange={() => {}}
        regeneratingTab={null}
      />,
    );
    expect(queryByText('tabBar.regenerating')).toBeNull();
  });

  it('shows the regenerating badge on an empty tab that matches regeneratingTab', () => {
    const { getByText } = render(
      <WorkflowTabBar
        tabs={[RESEARCH_TAB]}
        activeTab="research"
        tabStatus={{ research: false, question: false, plan: false, verify: false }}
        effectiveStatus="draft"
        onTabChange={() => {}}
        regeneratingTab="research"
      />,
    );
    expect(getByText('tabBar.regenerating')).toBeTruthy();
  });

  it('does not show the regenerating badge once the file exists again', () => {
    const { queryByText } = render(
      <WorkflowTabBar
        tabs={[RESEARCH_TAB]}
        activeTab="research"
        tabStatus={{ research: true, question: false, plan: false, verify: false }}
        effectiveStatus="research_done"
        onTabChange={() => {}}
        regeneratingTab="research"
      />,
    );
    expect(queryByText('tabBar.regenerating')).toBeNull();
  });
});
