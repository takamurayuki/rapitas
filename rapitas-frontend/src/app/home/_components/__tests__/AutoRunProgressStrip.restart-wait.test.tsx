/**
 * AutoRunProgressStrip.restart-wait.test
 *
 * While merged code waits to activate, no new work starts (task 1562), and the
 * strip says so — with the number of waiting updates when it is known
 * (2026-11-27 request). Split out of AutoRunProgressStrip.test.tsx to keep both
 * files under 300 lines.
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

const task = { id: 1682, title: '自動実行パネルに今のタスクを出す', status: 'in-progress' };

describe('AutoRunProgressStrip — restart wait', () => {
  it('shows 「更新の取り込み待ち」 only while a restart wait is in force', () => {
    const { unmount } = render(
      <AutoRunProgressStrip
        status="running"
        currentTask={{ ...task, workflowStatus: 'in_progress' }}
        remainingCount={5}
        startedAt={null}
        restartWait
      />,
    );
    expect(screen.getByTestId('auto-run-restart-wait')).toBeTruthy();
    expect(screen.getByText('autoRun.progress.restartWait')).toBeTruthy();
    unmount();

    render(
      <AutoRunProgressStrip
        status="running"
        currentTask={{ ...task, workflowStatus: 'in_progress' }}
        remainingCount={5}
        startedAt={null}
      />,
    );
    expect(screen.queryByTestId('auto-run-restart-wait')).toBeNull();
  });

  // 2026-11-27 request: say how many updates wait, as 「更新の取り込み待ち N件」.
  it('shows how many updates wait when the count is known', () => {
    render(
      <AutoRunProgressStrip
        status="running"
        currentTask={null}
        remainingCount={5}
        startedAt={null}
        restartWait
        pendingUpdateCount={2}
      />,
    );
    expect(screen.getByText('autoRun.progress.restartWaitCount{"count":2}')).toBeTruthy();
  });

  it('shows the restart wait between tasks too', () => {
    render(
      <AutoRunProgressStrip
        status="running"
        currentTask={null}
        remainingCount={5}
        startedAt={null}
        restartWait
      />,
    );
    expect(screen.getByTestId('auto-run-restart-wait')).toBeTruthy();
  });
});
