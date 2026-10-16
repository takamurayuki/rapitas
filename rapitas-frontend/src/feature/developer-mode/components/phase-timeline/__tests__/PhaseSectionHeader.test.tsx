/**
 * PhaseSectionHeader tests
 *
 * Verifies the current section's header carries the sticky positioning class
 * (task #785 §2 — no separate rail/tabs; each section's own header pins to
 * the top of the shared scroll container while its body is in view) and
 * exposes a clickable, accessible expand/collapse control.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { PhaseSectionHeader } from '../PhaseSectionHeader';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

describe('PhaseSectionHeader', () => {
  it('is positioned sticky to the top of its scroll container', () => {
    render(
      <PhaseSectionHeader
        phaseType="implement"
        iterationNumber={1}
        totalIterations={1}
        status="running"
        summaryText={null}
        expanded
        onToggle={() => {}}
        boundaryUncertain={false}
      />,
    );

    const header = screen.getByRole('button');
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('top-0');
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(
      <PhaseSectionHeader
        phaseType="verify"
        iterationNumber={1}
        totalIterations={1}
        status="completed"
        summaryText="summary text"
        expanded={false}
        onToggle={onToggle}
        boundaryUncertain={false}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows the boundary-uncertain warning icon when the boundary could not be confirmed', () => {
    render(
      <PhaseSectionHeader
        phaseType="research"
        iterationNumber={1}
        totalIterations={1}
        status="completed"
        summaryText="summary text"
        expanded={false}
        onToggle={() => {}}
        boundaryUncertain
      />,
    );

    expect(screen.getByLabelText('boundaryUncertain')).toBeInTheDocument();
  });
});
