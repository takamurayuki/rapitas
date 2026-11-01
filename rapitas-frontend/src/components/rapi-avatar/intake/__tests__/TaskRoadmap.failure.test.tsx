/**
 * TaskRoadmap.failure.test
 *
 * What the screen says when it does not work, and what the user can do next.
 *
 * Reported 2026-10-21: asking for a roadmap showed "うまくできませんでした"
 * and nothing else. The server had answered both draft calls successfully,
 * so neither the user nor the log could say which step had broken or why —
 * one boolean covered every failure and the reason reached only the browser
 * console. These tests hold the two things that fixes: the step and the
 * reason are on screen, and the step that failed is the one a retry runs.
 *
 * Split from TaskRoadmap.interview.test.tsx, which reached the size limit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

let notes: { title?: string; content?: string }[] = [];
let currentId: string | null = 'note-1';
/** Which tasks the note was attached to. */
let linked: { noteId: string; taskId: number }[] = [];
/** Whether the description updates should fail, to test best-effort. */
let patchFails = false;
const noteState = {
  createNote: (title?: string) => {
    notes.push({ title });
    currentId = `note-${notes.length}`;
  },
  updateNote: (_id: string, updates: { content?: string }) => {
    notes[notes.length - 1] = { ...notes[notes.length - 1], ...updates };
  },
  linkNoteToTask: (noteId: string, taskId: number) => {
    linked.push({ noteId, taskId });
  },
  currentNoteId: currentId,
};
vi.mock('@/stores/note-store', () => ({
  useNoteStore: Object.assign((selector: (s: typeof noteState) => unknown) => selector(noteState), {
    getState: () => ({ ...noteState, currentNoteId: currentId }),
  }),
}));

import { TaskRoadmap } from '../TaskRoadmap';

let requests: { url: string; body: Record<string, unknown>; method?: string }[] = [];

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
/** Which call should come back broken, and how. */
let breakDraft: number | null = null;
let breakCommit = false;

beforeEach(() => {
  requests = [];
  notes = [];
  linked = [];
  patchFails = false;
  currentId = 'note-1';
  rounds = [ASKED, PLANNED];
  breakDraft = null;
  breakCommit = false;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body)), method: init?.method });
    if (init?.method === 'PATCH') {
      return Promise.resolve({
        ok: !patchFails,
        status: patchFails ? 500 : 200,
        json: () => Promise.resolve({}),
      } as Response);
    }
    const isCommit = String(url).includes('/commit');
    if (isCommit && breakCommit) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      } as Response);
    }
    if (!isCommit && breakDraft !== null && drafts().length === breakDraft) {
      return Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      } as Response);
    }
    const body = isCommit ? COMMITTED : { available: true, draft: rounds.shift() ?? PLANNED };
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

describe('when it goes wrong', () => {
  // Reported 2026-10-21: "うまくできませんでした" was all the screen said. The
  // server had in fact answered both draft calls successfully, so neither the
  // user nor the log could tell which step broke or why. One boolean for
  // every failure is what made that undiagnosable.
  it('says which step failed and what came back', async () => {
    breakDraft = 1;
    open();
    await waitFor(() => expect(screen.getByText(/roadmap\.failedDrafting:/)).toBeTruthy());
    expect(screen.getByText(/HTTP 503/)).toBeTruthy();
  });

  it('tells creating apart from planning', async () => {
    breakCommit = true;
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(screen.getByText(/roadmap\.failedCreating:/)).toBeTruthy());
    expect(screen.getByText(/HTTP 500/)).toBeTruthy();
  });

  it('offers a way out instead of leaving the panel stuck', async () => {
    breakDraft = 1;
    open();
    await waitFor(() => screen.getByText('rapiAvatar.roadmap.retry'));
    breakDraft = null;
    fireEvent.click(screen.getByText('rapiAvatar.roadmap.retry'));
    await waitFor(() => expect(screen.getByText('現職を続けながら活動しますか')).toBeTruthy());
  });

  it('retries the step that failed, not the first one', async () => {
    // Failing the create and retrying must not throw the plan away and start
    // the interview again.
    breakCommit = true;
    open();
    await answerAndRefine();
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => screen.getByText('rapiAvatar.roadmap.retry'));
    breakCommit = false;
    fireEvent.click(screen.getByText('rapiAvatar.roadmap.retry'));
    await waitFor(() => expect(commits()).toHaveLength(2));
    expect(drafts()).toHaveLength(2);
  });

  it('clears the failure once something works', async () => {
    breakDraft = 1;
    open();
    await waitFor(() => screen.getByText('rapiAvatar.roadmap.retry'));
    breakDraft = null;
    fireEvent.click(screen.getByText('rapiAvatar.roadmap.retry'));
    await waitFor(() => expect(screen.queryByText(/roadmap\.failedDrafting:/)).toBeNull());
  });
});
