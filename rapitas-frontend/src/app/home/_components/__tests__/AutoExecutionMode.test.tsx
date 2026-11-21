/**
 * AutoExecutionMode.test
 *
 * The running state used to be one wide button labelled "タスク自動実行中" whose
 * click handler was `stop()`, with the red 停止 look living in an overlay that
 * only appeared on hover. So the visible label did not describe what clicking
 * did, nothing revealed that the control stopped anything until the pointer
 * was over it, and on a touch screen the stop was unreachable.
 *
 * Split in two (asked for 2026-10-31): the status says what is happening and
 * is not clickable, and a stop button sits beside it, always visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AutoRunStatus } from '@/hooks/workflow/useThemeAutoRun';

const autoRun = {
  status: 'running' as AutoRunStatus,
  start: vi.fn(),
  stop: vi.fn(),
  actionLoading: false,
  error: null as string | null,
};

vi.mock('@/hooks/workflow/useThemeAutoRun', () => ({
  useThemeAutoRun: () => ({
    data: { autoRun: { status: autoRun.status } },
    actionLoading: autoRun.actionLoading,
    error: autoRun.error,
    start: autoRun.start,
    stop: autoRun.stop,
  }),
}));

// Namespace-aware: the component reads three namespaces, and a mock that
// dropped the namespace would make two different keys collide.
vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const { AutoExecutionMode } = await import('../AutoExecutionMode');

const theme = { id: 1, isDevelopment: true };
const renderControl = () => render(<AutoExecutionMode theme={theme} />);

/** The stop control, by the label it carries in both namespaces' wording. */
const stopButton = () => screen.getByRole('button', { name: /autoRun\.stop/ });

beforeEach(() => {
  autoRun.status = 'running';
  autoRun.actionLoading = false;
  autoRun.error = null;
  autoRun.start.mockClear();
  autoRun.stop.mockClear();
});

describe('while auto-run is going', () => {
  it('shows a stop control without waiting for a hover', () => {
    renderControl();
    expect(stopButton()).toBeTruthy();

    // Checked up the whole ancestor chain, not on one element: the old
    // affordance was there all along, inside an overlay that `opacity-0` +
    // `group-hover:opacity-100` kept invisible until the pointer arrived.
    const classesAbove: string[] = [];
    for (let el: HTMLElement | null = screen.getByText('autoRun.stop'); el; el = el.parentElement) {
      classesAbove.push(el.className || '');
    }
    const chain = classesAbove.join(' ');
    expect(chain).not.toContain('opacity-0');
    expect(chain).not.toContain('group-hover');
  });

  it('stops when that control is pressed', () => {
    renderControl();
    fireEvent.click(stopButton());
    expect(autoRun.stop).toHaveBeenCalledTimes(1);
  });

  // The whole wide button used to stop the run, so a click meant for the
  // status — an element reading "実行中" — silently ended the run instead.
  it('does not make the status itself a way to stop', () => {
    renderControl();
    const status = screen.getByText('home.autoExecutionMode.runningLabel');
    expect(status.closest('button')).toBeNull();

    fireEvent.click(status);
    expect(autoRun.stop).not.toHaveBeenCalled();
  });

  it('still tells running apart from paused', () => {
    autoRun.status = 'paused';
    renderControl();
    expect(screen.getByText('home.autoExecutionMode.paused')).toBeTruthy();
    // And the stop is still reachable while paused.
    expect(stopButton()).toBeTruthy();
  });
});

// 2026-11-21: the status looked like a button (same border and bottom ridge as
// the toolbar buttons) while the stop beside it looked flat, and a paused run
// offered only 停止, so a pause could not be undone from the UI.
describe('status reads as text, actions read as buttons', () => {
  it('draws the status without a button frame or ridge', () => {
    renderControl();
    const status = screen.getByText('home.autoExecutionMode.runningLabel');
    const frame = status.closest('[data-auto-run-status]') as HTMLElement;
    expect(frame).toBeTruthy();
    expect(frame.className.split(/\s+/)).not.toContain('border');
    expect(frame.className).not.toContain('shadow-[');
  });

  // One accent for the whole control (asked 2026-11-21: five button colours on
  // one toolbar made the important action unclear). The stop is a neutral
  // ridge that only turns red under the pointer.
  it('gives the stop a neutral bottom ridge that turns red only on hover', () => {
    renderControl();
    const cls = stopButton().className;
    expect(cls).toContain('shadow-[0_2px_0_0_#d4d4d8]');
    expect(cls).toContain('hover:text-red-600');
    expect(cls.split(/\s+/).some((c) => c.startsWith('text-red-'))).toBe(false);
  });

  it('offers resuming a paused run in the start colour, which starts it again', () => {
    autoRun.status = 'paused';
    renderControl();
    const resume = screen.getByRole('button', { name: /autoRun\.resume/ });
    expect(resume.className).toContain('shadow-[0_2px_0_0_#a5b4fc]');
    fireEvent.click(resume);
    expect(autoRun.start).toHaveBeenCalledWith('priority');
  });

  // 2026-11-21: task actions and run actions should read as two groups at a
  // glance, without making the toolbar taller.
  it('sits in its own labelled group, also when idle', () => {
    renderControl();
    let group = screen.getByText('home.toolbarGroup.autoRun').closest('[data-toolbar-group]');
    expect(group?.getAttribute('data-toolbar-group')).toBe('auto-run');
    expect(group?.contains(stopButton())).toBe(true);

    autoRun.status = 'idle';
    renderControl();
    group = screen.getAllByText('home.toolbarGroup.autoRun')[1].closest('[data-toolbar-group]');
    expect(group?.getAttribute('data-toolbar-group')).toBe('auto-run');
  });

  it('offers no pause while running (a pause holds the only run slot)', () => {
    renderControl();
    expect(screen.queryByRole('button', { name: /autoRun\.pause/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /autoRun\.resume/ })).toBeNull();
  });
});

describe('while auto-run is off', () => {
  it('offers starting it, and no stop', () => {
    autoRun.status = 'idle';
    renderControl();
    expect(screen.getByRole('button', { name: /settings\.devModeTitle/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /autoRun\.stop/ })).toBeNull();
  });

  it('starts in priority order when pressed', () => {
    autoRun.status = 'idle';
    renderControl();
    fireEvent.click(screen.getByRole('button', { name: /settings\.devModeTitle/ }));
    expect(autoRun.start).toHaveBeenCalledWith('priority');
  });
});
