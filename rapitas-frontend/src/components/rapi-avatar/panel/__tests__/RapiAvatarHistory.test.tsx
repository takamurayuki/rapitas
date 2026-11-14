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
vi.mock('../../intake', () => ({
  TaskWatch: () => <div data-testid="mode-watch" />,
  TaskIntake: () => <div data-testid="mode-create" />,
  TaskAsk: () => <div data-testid="mode-ask" />,
  TaskConsult: () => <div data-testid="mode-consult" />,
  TaskTidy: () => <div data-testid="mode-tidy" />,
  TaskRoadmap: () => <div data-testid="mode-roadmap" />,
  taskIdFromLocation: () => null,
}));

/**
 * The composer, reduced to a way of routing a sentence from a test.
 *
 * Writing a sentence is the only way into a mode now that the tab bar is
 * gone, so every move between modes in these tests goes through here.
 */
const SENTENCES: Record<string, string> = {
  roadmap: '転職の計画',
  tidy: '片付けたい',
  watch: '何が止まってる？',
};
vi.mock('../RapiComposer', () => ({
  RapiComposer: ({ onRouted }: { onRouted: (r: unknown) => void }) => (
    <div>
      {Object.entries(SENTENCES).map(([intent, text]) => (
        <button key={intent} type="button" onClick={() => onRouted({ intent, reason: '', text })}>
          send-{intent}
        </button>
      ))}
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
  placement: {
    side: 'above' as const,
    right: 24,
    bottom: 100,
    width: 448,
    tailOffsetPx: 34,
    maxHeightPx: 600,
  },
  dark: false,
  open: true,
};

const show = () => render(<RapiAvatarPanel {...props} />);
const panelFor = (mode: string) => document.querySelector(`[data-rapi-mode-panel="${mode}"]`);
const showing = (mode: string) =>
  !!panelFor(mode) && (panelFor(mode) as HTMLElement).style.display !== 'none';
/**
 * Move to a mode the way a user now does: say something that goes there, or
 * press the way back to the conversation.
 */
const go = (mode: string) =>
  fireEvent.click(
    mode === 'chat'
      ? screen.getByLabelText('rapiAvatar.backToChat')
      : screen.getByText(`send-${mode}`),
  );
/** Open the panel and leave the conversation it opens on. */
const showOn = (mode: string) => {
  show();
  go(mode);
};

beforeEach(() => {
  pathname = '/dashboard';
});

describe('leaving a mode and coming back', () => {
  it('keeps what was there rather than unmounting it', async () => {
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    await waitFor(() => expect(showing('roadmap')).toBe(true));

    go('tidy');
    // Still mounted, just not the one on screen.
    expect(panelFor('roadmap')).toBeTruthy();
    expect(showing('roadmap')).toBe(false);
    expect(showing('tidy')).toBe(true);

    go('watch');
    expect(panelFor('roadmap')).toBeTruthy();
  });

  it('hides the ones not showing from assistive tech too', () => {
    // Kept for its state, not to be read out twice.
    showOn('watch');
    go('tidy');
    expect(panelFor('watch')?.getAttribute('aria-hidden')).toBe('true');
    expect(panelFor('tidy')?.getAttribute('aria-hidden')).toBeNull();
  });

  it('does not start every mode the moment the panel opens', () => {
    // Mounting all of them would set five modes fetching for one glance.
    showOn('watch');
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
    // Routing moved us off the conversation; the list of what was asked
    // lives there, which is also where the panel opens.
    go('chat');
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

    go('chat');
    fireEvent.click(screen.getByText('転職の計画'));
    expect(showing('roadmap')).toBe(true);
  });

  it('jumps rather than asking again', () => {
    // The mode still holds what it produced; re-running the sentence would
    // spend another model round-trip to arrive at the same screen.
    show();
    fireEvent.click(screen.getByText('send-roadmap'));
    go('watch');
    const before = panelFor('roadmap');
    go('chat');
    fireEvent.click(screen.getByText('転職の計画'));
    expect(panelFor('roadmap')).toBe(before);
  });
});
