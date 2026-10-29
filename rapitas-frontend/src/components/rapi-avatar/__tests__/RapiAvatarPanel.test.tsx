/**
 * RapiAvatarPanel.test
 *
 * What a hidden panel must not do.
 *
 * Closing her hides the panel rather than unmounting it, so that the typed
 * text, the chosen tab and any request in flight all survive. The cost of
 * that is a component that is still alive while nobody can see it, and the
 * dismissal listeners are the part that matters: left attached, the
 * outside-click handler calls `onClose` on every click anywhere in the app
 * and Escape does the same — a state write per click for a panel that is
 * already closed.
 *
 * This is tested on the panel directly rather than through the host, because
 * from the host it is invisible: calling `onClose` on something already
 * closed changes nothing, so a host-level test passes with or without the
 * guard. One was written that way first and did exactly that.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/resumable-executions/ExecutionItem', () => ({
  ExecutionItem: () => null,
}));

import { RapiAvatarPanel } from '../RapiAvatarPanel';

const show = (open: boolean, onClose: () => void) =>
  render(
    <RapiAvatarPanel
      open={open}
      executions={[]}
      resumingIds={new Set()}
      dismissingIds={new Set()}
      runningCount={0}
      interruptedCount={0}
      onResume={() => {}}
      onResumeAll={() => {}}
      onDismiss={() => {}}
      formatTimeAgo={() => '1分前'}
      onClose={onClose}
      bottomPx={100}
      tailOffsetPx={34}
      dark={false}
    />,
  );

describe('while it is hidden', () => {
  it('ignores a click somewhere else', () => {
    const onClose = vi.fn();
    show(false, onClose);
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Escape', () => {
    const onClose = vi.fn();
    show(false, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('while it is showing', () => {
  // The same listeners still have to work, or hiding would have bought the
  // state at the price of the dismissal.
  it('closes on a click somewhere else', () => {
    const onClose = vi.fn();
    show(true, onClose);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    show(true, onClose);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
