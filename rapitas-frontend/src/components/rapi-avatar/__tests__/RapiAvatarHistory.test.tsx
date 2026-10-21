/**
 * RapiAvatarHistory.test
 *
 * Getting back to what you were doing.
 *
 * Reported 2026-10-21: "pressing a tab means you cannot get back to what
 * you were talking about". That was literal — the panel drew only the
 * active mode, so switching unmounted the one you left and took its
 * contents with it: a drafted roadmap, the answers you had given, a search
 * that took a minute of real time.
 *
 * Two things fix it and both are held here. A mode you have opened stays
 * mounted and is hidden rather than removed, so going back shows what was
 * there. And the sentences themselves are listed, newest first, as a way
 * back to where each one went — a jump, not a replay, because replaying
 * would ask the model all over again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

/** Each mode marks itself, so "is it still mounted" is observable. */
vi.mock('../intake', () => ({
  TaskWatch: () => <div data-testid="mode-watch" />,
  TaskIntake: () => <div data-testid="mode-create" />,
  TaskAsk: () => <div data-testid="mode-ask" />,
  TaskConsult: () => <div data-testid="mode-consult" />,
  TaskTidy: () => <div data-testid="mode-tidy" />,
  TaskRoadmap: () => <div data-testid="mode-roadmap" />,
  taskIdFromLocation: () => null,
}));

/** The composer, reduced to a way of routing a sentence from a test. */
vi.mock('../RapiComposer', () => ({
  RapiComposer: ({ onRouted }: { onRouted: (r: unknown) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => onRouted({ intent: 'roadmap', reason: '', text: '転職の計画' })}
      >
        send-roadmap
      </button>
      <button
        type="button"
        onClick={() => onRouted({ intent: 'tidy', reason: '', text: '片付けたい' })}
      >
        send-tidy
      </button>
    </div>
  ),
}));

import { RapiAvatarPanel } from '../RapiAvatarPanel';

const props = {
  executions: [],
  resumingIds: new Set<number>(),
  dismissingIds: new Set<number>(),
  runningCount: 0,
  interruptedCount: 0,
  onResume: vi.fn(),
  onResumeAll: vi.fn(),
  onDismiss: vi.fn(),
  formatTimeAgo: () => '',
  onClose: vi.fn(),
  bottomPx: 100,
  tailOffsetPx: 34,
  dark: false,
  open: true,
};

const show = () => render(<RapiAvatarPanel {...props} />);
const panelFor = (mode: string) => document.querySelector(`[data-rapi-mode-panel="${mode}"]`);
const showing = (mode: string) =>
  !!panelFor(mode) && (panelFor(mode) as HTMLElement).style.display !== 'none';
const tab = (mode: string) => screen.getByLabelText(`rapiAvatar.mode.${mode}`);

beforeEach(() => {
  pathname = '/dashboard';
});

describe('leaving a mode and coming back', () => {
  it('keeps what was there rather than unmounting it', async () => {
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    await waitFor(() => expect(showing('roadmap')).toBe(true));

    fireEvent.click(tab('tidy'));
    // Still mounted, just not the one on screen.
    expect(panelFor('roadmap')).toBeTruthy();
    expect(showing('roadmap')).toBe(false);
    expect(showing('tidy')).toBe(true);

    fireEvent.click(tab('watch'));
    expect(panelFor('roadmap')).toBeTruthy();
  });

  it('hides the ones not showing from assistive tech too', () => {
    // Kept for its state, not to be read out twice.
    show();
    fireEvent.click(tab('tidy'));
    expect(panelFor('watch')?.getAttribute('aria-hidden')).toBe('true');
    expect(panelFor('tidy')?.getAttribute('aria-hidden')).toBeNull();
  });

  it('does not start every mode the moment the panel opens', () => {
    // Mounting all of them would set five modes fetching for one glance.
    show();
    expect(panelFor('watch')).toBeTruthy();
    expect(panelFor('tidy')).toBeNull();
    expect(panelFor('roadmap')).toBeNull();
  });
});

describe('the session history', () => {
  it('is absent until something has been asked', () => {
    show();
    expect(screen.queryByLabelText('rapiAvatar.history')).toBeNull();
  });

  it('lists what was asked, newest first', () => {
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    fireEvent.click(screen.getByText('send-tidy'));
    const chips = Array.from(
      screen.getByLabelText('rapiAvatar.history').querySelectorAll('button'),
    ).map((b) => b.textContent);
    expect(chips).toEqual(['片付けたい', '転職の計画']);
  });

  it('goes back to where an earlier sentence went', () => {
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    fireEvent.click(screen.getByText('send-tidy'));
    expect(showing('tidy')).toBe(true);

    fireEvent.click(screen.getByText('転職の計画'));
    expect(showing('roadmap')).toBe(true);
  });

  it('jumps rather than asking again', () => {
    // The mode still holds what it produced; re-running the sentence would
    // spend another model round-trip to arrive at the same screen.
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    fireEvent.click(tab('watch'));
    const before = panelFor('roadmap');
    fireEvent.click(screen.getByText('転職の計画'));
    expect(panelFor('roadmap')).toBe(before);
  });
});
