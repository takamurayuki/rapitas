/**
 * navigation-history-store.test
 *
 * Checks that recording history from inside React's insertion phase — where
 * the Next.js app router calls history.pushState — does not schedule a React
 * update, while the header still re-renders with the new position afterwards.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useInsertionEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { selectCanGoBack, useNavigationHistoryStore } from '../navigation-history-store';
import { installNavigationHistorySync } from '../navigation-history-sync';

function BackState() {
  const canGoBack = useNavigationHistoryStore(selectCanGoBack);
  return <span data-testid="can-back">{String(canGoBack)}</span>;
}

/** Stands in for Next.js's HistoryUpdater, which pushes in useInsertionEffect. */
function PushesDuringInsertion({ url }: { url: string | null }) {
  useInsertionEffect(() => {
    if (url) window.history.pushState(null, '', url);
  }, [url]);
  return null;
}

let uninstall: () => void = () => {};

describe('navigation history store notifications', () => {
  beforeEach(() => {
    useNavigationHistoryStore.setState({ entries: [], index: -1 });
    window.history.replaceState(null, '', '/');
    uninstall = installNavigationHistorySync();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  it('does not schedule a React update when a push happens in useInsertionEffect', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <>
        <BackState />
        <PushesDuringInsertion url={null} />
      </>,
    );
    expect(screen.getByTestId('can-back').textContent).toBe('false');

    await act(async () => {
      rerender(
        <>
          <BackState />
          <PushesDuringInsertion url="/dashboard" />
        </>,
      );
    });

    const insertionErrors = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('useInsertionEffect must not schedule updates'),
    );
    expect(insertionErrors).toEqual([]);
    // The store itself is updated synchronously, and the header catches up.
    expect(useNavigationHistoryStore.getState().entries).toEqual(['/', '/dashboard']);
    expect(screen.getByTestId('can-back').textContent).toBe('true');
  });
});
