import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionTimerPanel } from './decision-timer-panel';
import { useDecisionDurationStore } from '@/stores/decision-duration-store';
import type { TriageItem } from '../_lib/triage-rules';

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslations: () => t };
});

const item: TriageItem = {
  id: 1,
  requestType: 'task_execution',
  title: 't',
  proposedChanges: {},
  estimatedChanges: null,
  updatedAt: '',
};
const MIN = 60_000;

function seed(n: number) {
  for (let i = 0; i < n; i++) useDecisionDurationStore.getState().record('task_execution', 4 * MIN);
}

describe('DecisionTimerPanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useDecisionDurationStore.getState().clear();
  });

  it('shows the insufficient message, not a number, with fewer than 5 samples', () => {
    seed(4);
    render(<DecisionTimerPanel item={item} />);
    expect(screen.getByText(/^insufficient/)).toBeTruthy();
    expect(screen.queryByText(/^estimate/)).toBeNull();
  });

  it('shows the median in minutes with 10 samples', () => {
    seed(10);
    render(<DecisionTimerPanel item={item} />);
    expect(screen.getByText(/^estimate.*"minutes":4.*"count":10/)).toBeTruthy();
  });

  it('switches to finish after start and back to start after finish', () => {
    render(<DecisionTimerPanel item={item} />);
    fireEvent.click(screen.getByRole('button', { name: 'start' }));
    expect(screen.getByRole('button', { name: 'finish' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'finish' }));
    expect(screen.getByRole('button', { name: 'start' })).toBeTruthy();
  });
});
