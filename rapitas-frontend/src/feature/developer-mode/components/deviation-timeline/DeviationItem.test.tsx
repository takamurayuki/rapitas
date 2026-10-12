/**
 * DeviationItem tests — deviations are colour-coded, in-plan rows never render.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { DeviationItem } from './DeviationItem';
import type { DeviationEntry } from './deviation-timeline.types';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const outOfPlan: DeviationEntry = {
  category: 'out_of_plan',
  kind: 'command',
  seq: 2,
  occurredAt: '2026-10-13T01:02:03.000Z',
  tool: 'Bash',
  display: 'Bash: rm -rf x',
  logSequence: 7,
};

describe('DeviationItem', () => {
  test('out_of_plan renders with the warning (red) palette incl. dark mode', () => {
    render(<DeviationItem entry={outOfPlan} onSelect={() => {}} />);
    const row = screen.getByTestId('deviation-item');
    expect(row.getAttribute('data-category')).toBe('out_of_plan');
    expect(row.className).toContain('red');
    expect(row.className).toContain('dark:');
    expect(screen.getByText('Bash: rm -rf x')).toBeInTheDocument();
  });

  test('planned_not_executed renders with the caution (amber) palette', () => {
    render(
      <DeviationItem
        entry={{
          category: 'planned_not_executed',
          kind: 'file_change',
          display: 'docs/**',
          declaredItem: 'docs/**',
        }}
      />,
    );
    const row = screen.getByTestId('deviation-item');
    expect(row.className).toContain('amber');
    expect(row.tagName).not.toBe('BUTTON');
  });

  test('in_plan, pending and skipped entries are not rendered', () => {
    for (const category of ['in_plan', 'pending', 'skipped'] as const) {
      const { container, unmount } = render(<DeviationItem entry={{ ...outOfPlan, category }} />);
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });

  test('clicking a deviation with a log line calls onSelect', () => {
    const onSelect = vi.fn();
    render(<DeviationItem entry={outOfPlan} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('deviation-item'));
    expect(onSelect).toHaveBeenCalledWith(outOfPlan);
  });
});
