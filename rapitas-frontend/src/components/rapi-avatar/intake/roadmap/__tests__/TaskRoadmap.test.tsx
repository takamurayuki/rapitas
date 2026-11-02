/**
 * TaskRoadmap.test
 *
 * Talking something over until it is a set of tasks.
 *
 * Two properties carry the safety here, and they are what most of this
 * tests. The draft writes nothing, so the whole plan can be shown before
 * anything exists. The commit sends back exactly the plan that was shown —
 * no model runs in that half — so what gets made is what was read.
 *
 * The rest is about not lying when it goes wrong: a roadmap that stopped
 * halfway has to say where, because the alternative is the reader diffing a
 * plan against their backlog to find out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

/** The note store, stubbed down to what was written into it. */
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
let draftAnswer: Record<string, unknown>;
/** The final round answers with no questions, the way the server does. */
let refinedAnswer: Record<string, unknown>;
let commitAnswer: Record<string, unknown>;

const DRAFT = {
  goal: '英語のリスニングを続ける',
  themeChoice: { kind: 'new', name: '英語学習', reason: '既存に無い' },
  projectChoice: { kind: 'existing', id: 7, name: '自己開発' },
  questions: [
    {
      question: '1日どれくらい？',
      options: ['5分', '15分'],
      recommended: '15分',
      recommendedReason: '続けやすい長さのため',
    },
  ],
  steps: [
    { title: '教材を選ぶ', description: 'エピソード30本以上' },
    { title: '時間帯を決める', description: '毎日取れる枠を1つ' },
  ],
};

beforeEach(() => {
  requests = [];
  notes = [];
  currentId = 'note-1';
  draftAnswer = { available: true, draft: DRAFT };
  refinedAnswer = { available: true, draft: { ...DRAFT, questions: [] } };
  commitAnswer = { themeId: 100, projectId: 7, taskIds: [201, 202], failedAfter: null };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url, body });
    // The round is told apart the same way the route tells it apart: by
    // whether answers came with it.
    const answer = String(url).includes('/commit')
      ? commitAnswer
      : body.answers
        ? refinedAnswer
        : draftAnswer;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(answer),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const show = () => render(<TaskRoadmap handedOver="英語を毎日続けたい" />);
const commits = () => requests.filter((r) => r.url.includes('/commit'));

describe('drafting the plan', () => {
  it('asks once for what was handed over', async () => {
    show();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toContain('/assistant/roadmap/draft');
    expect(requests[0].body.text).toBe('英語を毎日続けたい');
  });

  // Nothing exists yet, which is what lets the whole plan be shown first.
  it('creates nothing while it is only a draft', async () => {
    show();
    await screen.findByText('英語のリスニングを続ける');
    expect(commits()).toEqual([]);
  });

  it('shows where the work would go, and that the theme is new', async () => {
    show();
    await waitFor(() =>
      expect(
        screen.getByText('rapiAvatar.roadmap.placement:英語学習rapiAvatar.roadmap.isNew,自己開発'),
      ).toBeTruthy(),
    );
  });

  it('lists every step with its description', async () => {
    show();
    expect(await screen.findByText('教材を選ぶ')).toBeTruthy();
    expect(screen.getByText('エピソード30本以上')).toBeTruthy();
  });

  // She has said which she would pick and why; leaving it blank makes the
  // reader redo that reasoning before they can disagree with it.
  it('starts each question on its recommendation', async () => {
    show();
    const chosen = await screen.findByText('15分');
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows why that one is recommended', async () => {
    show();
    expect(await screen.findByText('続けやすい長さのため')).toBeTruthy();
  });

  it('lets the recommendation be overridden', async () => {
    // Choosing now closes the question and leaves a one-line decision, so
    // what proves the override is that line reading the chosen option rather
    // than the recommended one.
    show();
    fireEvent.click(await screen.findByText('5分'));
    const line = document.querySelector('[data-roadmap-answered]');
    expect(line?.textContent).toContain('5分');
    expect(line?.textContent).not.toContain('15分');
  });

  it('says so rather than showing an empty plan', async () => {
    draftAnswer = { available: false };
    show();
    await waitFor(() => expect(screen.getByText('rapiAvatar.roadmap.unavailable')).toBeTruthy());
  });
});

describe('creating it', () => {
  // The questions have to be answered first now: a draft that still carries
  // them is a sketch, and creating the sketch is what made the interview
  // decorative. See TaskRoadmap.interview.test.tsx.
  const create = async () => {
    show();
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.refine'));
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.create:2'));
    await waitFor(() => expect(commits()).toHaveLength(1));
  };

  // The commit runs no model, so what is created is what was read. Sending
  // the plan back is how that is guaranteed.
  it('sends back exactly the plan that was shown', async () => {
    await create();
    expect(commits()[0].body).toMatchObject({
      confirmed: true,
      goal: DRAFT.goal,
      themeChoice: DRAFT.themeChoice,
      steps: DRAFT.steps,
    });
  });

  // The capability declares requiresConfirmation; this is what carries it.
  it('carries the confirmation in the payload', async () => {
    await create();
    expect(commits()[0].body.confirmed).toBe(true);
  });

  it('reports how many were created', async () => {
    await create();
    await waitFor(() => expect(screen.getByText('rapiAvatar.roadmap.created:2')).toBeTruthy());
  });

  // Half a roadmap is worse than none if nobody says which half.
  it('says where it stopped when it stopped partway', async () => {
    commitAnswer = { themeId: 100, projectId: 7, taskIds: [201], failedAfter: 1 };
    await create();
    await waitFor(() => expect(screen.getByText('rapiAvatar.roadmap.stoppedAfter:1')).toBeTruthy());
  });
});

describe('the note it leaves behind', () => {
  const create = async () => {
    show();
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.refine'));
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.create:2'));
    await waitFor(() => expect(notes).toHaveLength(1));
  };

  it('writes one, titled after the goal', async () => {
    await create();
    expect(notes[0].title).toBe('英語のリスニングを続ける');
  });

  // The request asked for the assumptions to live in the note rather than
  // in the task descriptions, which are for what "done" means.
  it('records what was decided, and why it goes where it goes', async () => {
    await create();
    const body = notes[0].content ?? '';
    expect(body).toContain('1日どれくらい？ → 15分');
    expect(body).toContain('英語学習');
    expect(body).toContain('自己開発');
  });

  it('links each task it created, with the header intact', async () => {
    await create();
    expect(notes[0].content).toContain('/tasks/201?showHeader=true');
    expect(notes[0].content).toContain('/tasks/202?showHeader=true');
  });

  it('records the answer the user chose, not the recommendation', async () => {
    show();
    fireEvent.click(await screen.findByText('5分'));
    fireEvent.click(screen.getByText('rapiAvatar.roadmap.refine'));
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.create:2'));
    await waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0].content).toContain('→ 5分');
  });
});
