/**
 * TestCorrelationHeatmap.test
 *
 * Verifies loading/empty states, low-confidence dimming, the non-deterministic
 * flag indicator, and cell-click wiring.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TestCorrelationHeatmap } from './TestCorrelationHeatmap';
import type { CorrelationCell } from '../test-correlation.types';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

function cell(overrides: Partial<CorrelationCell> = {}): CorrelationCell {
  return {
    changedFile: 'src/a.ts',
    testFile: 'src/a.test.ts',
    correlation: 0.7,
    pValue: 0.01,
    sampleSize: 10,
    confidence: 'high',
    nonDeterministic: false,
    ...overrides,
  };
}

describe('TestCorrelationHeatmap', () => {
  it('renders a skeleton while loading', () => {
    const { container } = render(
      <TestCorrelationHeatmap cells={[]} loading={true} onCellClick={vi.fn()} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the empty message when there are no cells', () => {
    render(<TestCorrelationHeatmap cells={[]} loading={false} onCellClick={vi.fn()} />);
    expect(screen.getByText('testCorrelation.heatmap.empty')).toBeInTheDocument();
  });

  it('dims low-confidence cells', () => {
    render(
      <TestCorrelationHeatmap
        cells={[cell({ confidence: 'low' })]}
        loading={false}
        onCellClick={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('opacity-60');
  });

  it('does not dim high-confidence cells', () => {
    render(
      <TestCorrelationHeatmap
        cells={[cell({ confidence: 'high' })]}
        loading={false}
        onCellClick={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.className).not.toContain('opacity-60');
  });

  it('shows a non-deterministic flag indicator when nonDeterministic is true', () => {
    const { container } = render(
      <TestCorrelationHeatmap
        cells={[cell({ nonDeterministic: true })]}
        loading={false}
        onCellClick={vi.fn()}
      />,
    );
    expect(container.querySelector('.bg-amber-500')).not.toBeNull();
  });

  it('calls onCellClick with the changed file and test file when a cell is clicked', () => {
    const onCellClick = vi.fn();
    render(
      <TestCorrelationHeatmap
        cells={[cell({ changedFile: 'src/a.ts', testFile: 'src/a.test.ts' })]}
        loading={false}
        onCellClick={onCellClick}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onCellClick).toHaveBeenCalledWith('src/a.ts', 'src/a.test.ts');
  });
});
