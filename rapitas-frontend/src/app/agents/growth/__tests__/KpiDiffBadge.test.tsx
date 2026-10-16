/**
 * KpiDiffBadge.test
 *
 * Verifies the diff badge colours improvement green and regression red for
 * both improvement directions, keeps neutral series grey, and hides itself
 * when either week has no value.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiDiffBadge } from '../components/KpiDiffBadge';
import type { KpiDiff } from '../components/retro-kpi-points';

function renderBadge(diff: KpiDiff, valueFormat: 'percent' | 'count' | 'minutes' = 'count') {
  return render(<KpiDiffBadge diff={diff} label="vs" valueFormat={valueFormat} />);
}

describe('KpiDiffBadge', () => {
  it('higher_is_better: increase is green (improved)', () => {
    renderBadge({ currentValue: 5, previousValue: 3, direction: 'higher_is_better' });
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'improved');
    expect(badge.className).toContain('text-green-600');
    expect(badge).toHaveTextContent('+2');
  });

  it('higher_is_better: decrease is red (worsened)', () => {
    renderBadge({ currentValue: 3, previousValue: 5, direction: 'higher_is_better' });
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'worsened');
    expect(badge.className).toContain('text-red-600');
    expect(badge).toHaveTextContent('-2');
  });

  it('lower_is_better: decrease is green (improved) even though the arrow points down', () => {
    renderBadge(
      { currentValue: 0.3, previousValue: 0.34, direction: 'lower_is_better' },
      'percent',
    );
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'improved');
    expect(badge.className).toContain('text-green-600');
    expect(badge).toHaveTextContent('-4.0pt');
  });

  it('lower_is_better: increase is red (worsened)', () => {
    renderBadge({ currentValue: 70, previousValue: 57, direction: 'lower_is_better' }, 'minutes');
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'worsened');
    expect(badge.className).toContain('text-red-600');
    expect(badge).toHaveTextContent('+13分');
  });

  it('neutral: any change stays grey', () => {
    renderBadge({ currentValue: 40, previousValue: 29, direction: 'neutral' });
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    expect(badge.className).toContain('text-zinc-500');
    expect(badge.className).not.toContain('text-green-600');
    expect(badge.className).not.toContain('text-red-600');
  });

  it('equal values stay grey regardless of direction', () => {
    renderBadge({ currentValue: 4, previousValue: 4, direction: 'lower_is_better' });
    const badge = screen.getByTestId('kpi-diff-badge');
    expect(badge).toHaveAttribute('data-tone', 'neutral');
    expect(badge).toHaveTextContent('±0');
  });

  it('renders nothing when the previous week has no value', () => {
    renderBadge({ currentValue: 4, previousValue: null, direction: 'lower_is_better' });
    expect(screen.queryByTestId('kpi-diff-badge')).not.toBeInTheDocument();
  });

  it('renders nothing when the current week has no value', () => {
    renderBadge({ currentValue: null, previousValue: 4, direction: 'lower_is_better' });
    expect(screen.queryByTestId('kpi-diff-badge')).not.toBeInTheDocument();
  });
});
