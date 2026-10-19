/**
 * TaskIntake.test
 *
 * The two-step shape, from the outside: describing something gets you a
 * proposal to look at, and only a deliberate press turns it into a task.
 *
 * The assertions are on the requests that were made, not on what rendered —
 * a version that filed the task behind the card would look identical.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { TaskIntake } from '../TaskIntake';
import type { TaskDraft } from '../task-draft-types';

const DRAFT: TaskDraft = {
  title: 'アバターを直す',
  description: 'rapitas のアバターを直す 2時間',
  estimatedHours: 2,
  themeId: 1,
  themeCandidates: [
    { id: 1, name: 'rapitas' },
    { id: 2, name: '健康' },
  ],
  missing: [],
  reasons: { theme: { code: 'matchedThemeName', value: 'rapitas' } },
};

let requests: { url: string; body: Record<string, unknown> | null }[] = [];
let draft: TaskDraft = DRAFT;
let source: 'intent' | 'patterns' = 'intent';

beforeEach(() => {
  requests = [];
  draft = DRAFT;
  source = 'intent';
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(url.includes('/assistant/task-draft') ? { draft, source } : { id: 7 }),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Requests that would create a task — through ラピ's own surface only. */
const writes = () => requests.filter((r) => r.url.includes('/assistant/task-create'));

const say = (what: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: what } });
  fireEvent.click(screen.getByText('rapiAvatar.intake.propose'));
};

describe('describing something', () => {
  it('shows what ラピ understood', async () => {
    render(<TaskIntake />);
    say('rapitas のアバターを直す 2時間');
    await waitFor(() => expect(screen.getByText('rapiAvatar.intake.draftHeading')).toBeTruthy());
    expect(screen.getByDisplayValue('アバターを直す')).toBeTruthy();
  });

  // The whole reason this is two steps.
  it('creates nothing', async () => {
    render(<TaskIntake />);
    say('rapitas のアバターを直す 2時間');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(writes()).toEqual([]);
  });

  it('says why it chose the theme', async () => {
    render(<TaskIntake />);
    say('rapitas のアバターを直す');
    await waitFor(() =>
      expect(screen.getByText('rapiAvatar.intake.reason.matchedThemeName')).toBeTruthy(),
    );
  });
});

describe('confirming', () => {
  const toCard = async () => {
    render(<TaskIntake />);
    say('rapitas のアバターを直す 2時間');
    await waitFor(() => expect(screen.getByText('rapiAvatar.intake.draftHeading')).toBeTruthy());
  };

  it('files only when the button is pressed', async () => {
    await toCard();
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByText('rapiAvatar.intake.file'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toMatchObject({
      confirmed: true,
      task: { title: 'アバターを直す', themeId: 1 },
    });
  });

  it('files the correction, not the proposal', async () => {
    await toCard();
    fireEvent.change(screen.getByDisplayValue('アバターを直す'), {
      target: { value: '直し直す' },
    });
    fireEvent.click(screen.getByText('rapiAvatar.intake.file'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body?.task as Record<string, unknown>).title).toBe('直し直す');
  });

  it('links to what it created', async () => {
    await toCard();
    fireEvent.click(screen.getByText('rapiAvatar.intake.file'));
    const link = await screen.findByText('rapiAvatar.intake.openFiled');
    // Headered, so the task opens with its way back intact.
    expect(link.getAttribute('href')).toBe('/tasks/7?showHeader=true');
  });

  it('throws the proposal away on discard, creating nothing', async () => {
    await toCard();
    fireEvent.click(screen.getByText('rapiAvatar.intake.discard'));
    await waitFor(() => expect(screen.queryByText('rapiAvatar.intake.draftHeading')).toBeNull());
    expect(writes()).toEqual([]);
  });
});

/**
 * What reading intent added. The theme reasoning is the model's sentence
 * about this particular utterance, so it is shown as written rather than
 * mapped onto a catalogue phrase.
 */
describe('what the model worked out', () => {
  beforeEach(() => {
    draft = {
      ...DRAFT,
      themeReason: 'アバターは rapitas 本体の機能のため',
      acceptanceCriteria: ['長文でも吹き出しの幅を超えない'],
      unclear: ['いつまでに必要か'],
    };
  });

  it('shows why it chose that theme, in its own words', async () => {
    render(<TaskIntake />);
    say('アバターの吹き出しが長文だと崩れる');
    await waitFor(() =>
      expect(screen.getByText('アバターは rapitas 本体の機能のため')).toBeTruthy(),
    );
  });

  it('shows what it could not work out, instead of guessing', async () => {
    render(<TaskIntake />);
    say('アバターの吹き出しが長文だと崩れる');
    await waitFor(() => expect(screen.getByText('いつまでに必要か')).toBeTruthy());
  });

  // Criteria nobody can reach are a known cause of endless verification
  // bounce-backs, so they must be editable before the task exists.
  it('files the criteria as the user left them', async () => {
    render(<TaskIntake />);
    say('アバターの吹き出しが長文だと崩れる');
    const box = await screen.findByDisplayValue('長文でも吹き出しの幅を超えない');
    fireEvent.change(box, { target: { value: '幅を超えない\n縦にも伸びない' } });
    fireEvent.click(screen.getByText('rapiAvatar.intake.file'));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body?.task as Record<string, unknown>).acceptanceCriteria).toEqual([
      '幅を超えない',
      '縦にも伸びない',
    ]);
  });
});

describe('when the model was unavailable', () => {
  it('warns that the fields were only pattern-matched', async () => {
    source = 'patterns';
    render(<TaskIntake />);
    say('rapitas のアバターを直す');
    await waitFor(() =>
      expect(screen.getByText('rapiAvatar.intake.fellBackToPatterns')).toBeTruthy(),
    );
  });

  it('says nothing of the sort when the intent was read', async () => {
    render(<TaskIntake />);
    say('アバターの吹き出しが崩れる');
    await waitFor(() => expect(screen.getByText('rapiAvatar.intake.draftHeading')).toBeTruthy());
    expect(screen.queryByText('rapiAvatar.intake.fellBackToPatterns')).toBeNull();
  });
});

describe('when ラピ could not pick the theme', () => {
  beforeEach(() => {
    draft = { ...DRAFT, themeId: undefined, missing: ['theme'], reasons: {} };
  });

  it('cannot be filed until the user picks one', async () => {
    render(<TaskIntake />);
    say('ゴミを出す');
    await waitFor(() => expect(screen.getByText('rapiAvatar.intake.draftHeading')).toBeTruthy());

    const fileButton = screen.getByText('rapiAvatar.intake.file').closest('button');
    expect(fileButton?.hasAttribute('disabled')).toBe(true);

    fireEvent.click(fileButton!);
    expect(writes()).toEqual([]);

    fireEvent.change(screen.getByDisplayValue('rapiAvatar.intake.chooseTheme'), {
      target: { value: '2' },
    });
    await waitFor(() => expect(fileButton?.hasAttribute('disabled')).toBe(false));
    fireEvent.click(fileButton!);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0].body?.task as Record<string, unknown>).themeId).toBe(2);
  });
});
