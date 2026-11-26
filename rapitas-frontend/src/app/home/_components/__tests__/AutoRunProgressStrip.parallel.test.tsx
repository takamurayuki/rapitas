/**
 * AutoRunProgressStrip.parallel.test
 *
 * Task 1552: with several tasks running in one theme the strip says how many
 * run in parallel and links the others; with one task it looks as before.
 * Also covers withCompanions, which copies the companions onto the head.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CurrentTask } from '@/hooks/workflow/useThemeAutoRun';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, params?: Record<string, unknown>) =>
    `${namespace}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoRunProgressStrip } = await import('../AutoRunProgressStrip');
const { withCompanions } = await import('@/hooks/workflow/useThemeAutoRun');

const head: CurrentTask = {
  id: 10,
  title: 'head',
  status: 'in-progress',
  workflowStatus: 'in_progress',
};

function renderWith(currentTask: CurrentTask | null) {
  return render(
    <AutoRunProgressStrip
      status="running"
      currentTask={currentTask}
      remainingCount={3}
      startedAt={null}
    />,
  );
}

describe('AutoRunProgressStrip — parallel tasks in one theme', () => {
  it('shows the parallel count and links each companion', () => {
    renderWith(
      withCompanions(head, [
        { id: 10, title: 'head', role: 'head' },
        { id: 11, title: 'second', role: 'companion' },
      ]),
    );
    const badge = screen.getByTestId('auto-run-parallel');
    expect(badge.textContent).toContain('autoRun.progress.parallel{"count":2}');
    const link = screen.getByRole('link', { name: '#11 second' });
    expect(link.getAttribute('href')).toBe('/tasks/11?showHeader=true');
    expect(link.textContent).toContain('second');
  });

  it('one task → no parallel badge (the pre-task display)', () => {
    renderWith(withCompanions(head, [{ id: 10, title: 'head', role: 'head' }]));
    expect(screen.queryByTestId('auto-run-parallel')).toBeNull();
  });

  it('an older backend without activeTasks keeps the head as is', () => {
    expect(withCompanions(head, undefined)).toBe(head);
    expect(withCompanions(null, [{ id: 11, title: 'x', role: 'companion' }])).toBeNull();
  });
});
