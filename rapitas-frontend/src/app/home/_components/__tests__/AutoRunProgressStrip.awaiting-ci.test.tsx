/**
 * AutoRunProgressStrip.awaiting-ci.test
 *
 * Tasks that gave their slot back while they wait for CI show as 「CI 待ち」
 * links, also while auto-run is idle or stopping (task 1570).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, params?: Record<string, unknown>) =>
    `${namespace}.${key}${params ? JSON.stringify(params) : ''}`,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoRunProgressStrip } = await import('../AutoRunProgressStrip');

const entry = (taskId: number) => ({
  taskId,
  title: `task ${taskId}`,
  cause: 'verify_awaiting_required_merge',
  since: '2026-11-28T00:00:00.000Z',
});

describe('AutoRunProgressStrip — CI wait', () => {
  it('links every CI-waiting task beside the running one', () => {
    render(
      <AutoRunProgressStrip
        status="running"
        currentTask={{
          id: 1,
          title: 'head',
          status: 'in-progress',
          workflowStatus: 'in_progress',
        }}
        remainingCount={3}
        startedAt={null}
        awaitingCi={[entry(7), entry(8)]}
      />,
    );

    const band = screen.getByTestId('auto-run-awaiting-ci');
    expect(band.textContent).toContain('autoRun.awaitingCi.label');
    expect(screen.getByTestId('ClockArrowUp-icon')).toBeTruthy();
    const link = screen.getByRole('link', { name: '#7 task 7' });
    expect(link.getAttribute('href')).toBe('/tasks/7?showHeader=true');
    expect(screen.getByRole('link', { name: '#8 task 8' })).toBeTruthy();
  });

  it.each(['idle', 'stopping'] as const)(
    'shows only the wait and the backlog while %s',
    (status) => {
      render(
        <AutoRunProgressStrip
          status={status}
          currentTask={{ id: 1, title: 'stale', status: 'in-progress', workflowStatus: null }}
          remainingCount={3}
          startedAt="2026-11-28T00:00:00.000Z"
          restartWait
          awaitingCi={[entry(7)]}
        />,
      );

      expect(screen.getByTestId('auto-run-awaiting-ci')).toBeTruthy();
      expect(screen.getByText('autoRun.progress.remaining{"count":3}')).toBeTruthy();
      expect(screen.queryByText(/progress\.elapsed/)).toBeNull();
      expect(screen.queryByText('autoRun.progress.choosingNext')).toBeNull();
      expect(screen.queryByRole('link', { name: '#1 stale' })).toBeNull();
      expect(screen.queryByTestId('auto-run-restart-wait')).toBeNull();
    },
  );

  it('draws nothing while idle with no CI wait', () => {
    const { container } = render(
      <AutoRunProgressStrip
        status="idle"
        currentTask={null}
        remainingCount={3}
        startedAt={null}
        awaitingCi={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
