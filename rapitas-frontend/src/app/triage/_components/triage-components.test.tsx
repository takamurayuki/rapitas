import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TriageLiveRegion } from './triage-live-region';
import { TriageItemCard } from './triage-item-card';

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  t.has = () => true;
  return { useTranslations: () => t };
});

describe('TriageLiveRegion', () => {
  it('puts routine messages in the polite region only', () => {
    render(<TriageLiveRegion message="approved. 12 left" politeness="polite" seq={1} />);
    expect(screen.getByRole('status').textContent).toContain('approved. 12 left');
    expect(screen.getByRole('alert').textContent).toBe('');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('puts conflicts in the assertive region only', () => {
    render(<TriageLiveRegion message="conflict" politeness="assertive" seq={2} />);
    expect(screen.getByRole('alert').textContent).toContain('conflict');
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('TriageItemCard', () => {
  it('lists kind, summary, impact before amount, in that order', () => {
    const { container } = render(
      <TriageItemCard
        item={{
          id: 1,
          requestType: 'subtask_creation',
          title: 'Split it',
          proposedChanges: { subtasks: [{}, {}], amount: 20000 },
          estimatedChanges: null,
          updatedAt: '2026-10-15T00:00:00.000Z',
        }}
      />,
    );
    const terms = Array.from(container.querySelectorAll('dt')).map((n) => n.textContent);
    expect(terms).toEqual(['kind', 'summary', 'impact', 'amount']);
    const defs = Array.from(container.querySelectorAll('dd')).map((n) => n.textContent);
    expect(defs[0]).toBe('kinds.subtask_creation');
    expect(defs[1]).toBe('Split it');
    expect(defs[2]).toContain('"count":2');
  });
});
