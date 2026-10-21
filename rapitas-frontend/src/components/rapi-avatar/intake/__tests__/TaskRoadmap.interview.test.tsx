/**
 * TaskRoadmap.interview.test
 *
 * The second round, and the bug that made the first one pointless.
 *
 * She asked good questions, the user answered them, and then the plan that
 * got created was the one drafted *before* they answered — the choices only
 * ever reached the closing note. Whatever was picked, the same tasks
 * appeared. So the load-bearing test here is the last one: what the commit
 * sends is the plan that came back after the answers went out, not the
 * provisional one.
 *
 * The rest is the shape the request asked for — dates on screen when a
 * deadline was named, dates in the payload so they reach the task, and the
 * decisions kept in the note even though the final round returns no
 * questions to read them off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

let notes: { title?: string; content?: string }[] = [];
let currentId: string | null = 'note-1';
const noteState = {
  createNote: (title?: string) => {
    notes.push({ title });
    currentId = `note-${notes.length}`;
  },
  updateNote: (_id: string, updates: { content?: string }) => {
    notes[notes.length - 1] = { ...notes[notes.length - 1], ...updates };
  },
  currentNoteId: currentId,
};
vi.mock('@/stores/note-store', () => ({
  useNoteStore: Object.assign((selector: (s: typeof noteState) => unknown) => selector(noteState), {
    getState: () => ({ ...noteState, currentNoteId: currentId }),
  }),
}));

import { TaskRoadmap } from '../TaskRoadmap';

let requests: { url: string; body: Record<string, unknown> }[] = [];

/** Round one: it asks, and the steps it shows are provisional. */
const ASKED = {
  goal: '転職する',
  themeChoice: { kind: 'new', name: '転職活動', reason: '既存に無い' },
  projectChoice: { kind: 'none', reason: '単発のため' },
  questions: [
    {
      question: '現職を続けながら活動しますか',
      options: ['続けながら', '退職して集中'],
      recommended: '続けながら',
      recommendedReason: '収入が途切れないため',
    },
  ],
  steps: [{ title: '暫定の一歩', description: 'まだ回答前の案' }],
};

/** Round two: decided, dated, and no longer asking. */
const PLANNED = {
  ...ASKED,
  questions: [],
  deadline: '2027-01-19',
  steps: [
    {
      title: '職務経歴書を作る',
      description: 'やること\n\n## 完了条件\n- [ ] A4 1枚',
      dueDate: '2026-11-04',
    },
    { title: '15社に応募する', description: '応募する', dueDate: '2027-01-19' },
  ],
};

const COMMITTED = { themeId: 100, projectId: null, taskIds: [301, 302], failedAfter: null };

/** Each `/draft` call answers with the next round in turn. */
let rounds: Record<string, unknown>[] = [];

beforeEach(() => {
  requests = [];
  notes = [];
  currentId = 'note-1';
  rounds = [ASKED, PLANNED];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    const body = String(url).includes('/commit')
      ? COMMITTED
      : { available: true, draft: rounds.shift() ?? PLANNED };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = () => render(<TaskRoadmap handedOver="3ヶ月後までに転職したい" />);
const drafts = () => requests.filter((r) => r.url.includes('/draft'));
const commits = () => requests.filter((r) => r.url.includes('/commit'));
const button = (key: string) => screen.getByText(`rapiAvatar.roadmap.${key}`);

/** Answer the question she asked, then ask her to plan against it. */
const answerAndRefine = async () => {
  await waitFor(() => screen.getByText('現職を続けながら活動しますか'));
  fireEvent.click(screen.getByText('退職して集中'));
  fireEvent.click(button('refine'));
  await waitFor(() => expect(drafts()).toHaveLength(2));
};

describe('the answers she asked for', () => {
  it('go back out with the question they answered', async () => {
    open();
    await answerAndRefine();
    expect(drafts()[1]?.body.answers).toEqual([
      { question: '現職を続けながら活動しますか', answer: '退職して集中' },
    ]);
  });

  it('are not sent on the first round, which is what asks for them', async () => {
    open();
    await waitFor(() => expect(drafts()).toHaveLength(1));
    expect(drafts()[0]?.body.answers).toBeUndefined();
  });

  it('must be given before anything can be created', async () => {
    // The provisional plan is a sketch. Offering to create it is what made
    // the interview decorative in the first place.
    open();
    await waitFor(() => screen.getByText('現職を続けながら活動しますか'));
    expect(screen.queryByText(/roadmap\.create:/)).toBeNull();
  });

  it('are skipped entirely when she had nothing to ask', async () => {
    rounds = [{ ...ASKED, questions: [] }];
    open();
    await waitFor(() => screen.getByText(/roadmap\.create:/));
    expect(screen.queryByText('rapiAvatar.roadmap.refine')).toBeNull();
  });
});

describe('what the commit is given', () => {
  it('is the plan that came back after the answers, not the sketch', async () => {
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(commits()).toHaveLength(1));
    const steps = commits()[0]?.body.steps as { title: string }[];
    expect(steps.map((s) => s.title)).toEqual(['職務経歴書を作る', '15社に応募する']);
    expect(steps.map((s) => s.title)).not.toContain('暫定の一歩');
  });

  it('carries the dates, or the deadline never reaches the task', async () => {
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(commits()).toHaveLength(1));
    const steps = commits()[0]?.body.steps as { dueDate?: string }[];
    expect(steps[0]?.dueDate).toBe('2026-11-04');
  });
});

describe('what the reader is shown and left with', () => {
  it('shows the deadline it worked back from', async () => {
    open();
    await answerAndRefine();
    expect(screen.getByText(/roadmap\.deadline:2027-01-19/)).toBeTruthy();
  });

  it('shows each step its own date', async () => {
    open();
    await answerAndRefine();
    expect(screen.getByText(/2026-11-04/)).toBeTruthy();
  });

  it('keeps the decisions in the note although the last round asks nothing', async () => {
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(notes).toHaveLength(1));
    const written = notes[0]?.content ?? '';
    expect(written).toContain('現職を続けながら活動しますか');
    expect(written).toContain('退職して集中');
  });

  it('writes the dates into the note beside what they belong to', async () => {
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]?.content ?? '').toContain('2027-01-19');
  });
});
