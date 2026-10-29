/**
 * TaskRoadmap.research.test
 *
 * Looking the candidates up, and keeping what was found apart from what
 * was not.
 *
 * This is the one thing ラピ does that reaches outside the machine, so the
 * tests are about the line a reader has to be able to see: every candidate
 * is a link to the page it came from, a cell the search did not establish
 * stays empty, and the axes nothing was found for are said out loud. A
 * table of plausible numbers with no sources would be worse than no table.
 *
 * Offered rather than automatic, and only where there is something to
 * choose between — a plan to tidy the flat has nothing to search for.
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
  linkNoteToTask: () => {},
  currentNoteId: currentId,
};
vi.mock('@/stores/note-store', () => ({
  useNoteStore: Object.assign((selector: (s: typeof noteState) => unknown) => selector(noteState), {
    getState: () => ({ ...noteState, currentNoteId: currentId }),
  }),
}));

import { TaskRoadmap } from '../TaskRoadmap';

let requests: { url: string; body: Record<string, unknown> }[] = [];
let researchAvailable = true;
let researchFails = false;

/** A finished plan whose goal is a choice, so there is something to look up. */
const PLANNED = {
  goal: 'SESから自社開発のWeb系に転職する',
  themeChoice: { kind: 'new', name: '転職活動', reason: '' },
  projectChoice: { kind: 'none', reason: '' },
  questions: [],
  steps: [{ title: '職務経歴書を作る', description: 'やること' }],
  comparisonAxes: ['年収', '技術スタック'],
  assumptions: [],
};

const FINDINGS = {
  query: '自社開発 Web系 求人',
  candidates: [
    {
      name: 'A社',
      sourceUrl: 'https://example.com/a',
      values: { 年収: '600〜800万', 技術スタック: 'TypeScript' },
      why: '自社開発',
    },
    {
      name: 'B社',
      sourceUrl: 'https://example.com/b',
      values: { 年収: '350〜600万' },
      why: '技術スタックは確認できなかった',
    },
  ],
  unresolvedAxes: [] as string[],
};

const COMMITTED = { themeId: 1, projectId: null, taskIds: [301], failedAfter: null };

beforeEach(() => {
  requests = [];
  notes = [];
  currentId = 'note-1';
  researchAvailable = true;
  researchFails = false;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    requests.push({ url, body });
    if (String(url).includes('/research')) {
      if (researchFails) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            researchAvailable ? { available: true, findings: FINDINGS } : { available: false },
          ),
      } as Response);
    }
    if (String(url).includes('/commit')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(COMMITTED),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ available: true, draft: PLANNED }),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const open = () => render(<TaskRoadmap handedOver="自社開発のWeb系に転職したい" />);
const searches = () => requests.filter((r) => r.url.includes('/research'));
const lookUp = async () => {
  await waitFor(() => screen.getByText('rapiAvatar.roadmap.research'));
  fireEvent.click(screen.getByText('rapiAvatar.roadmap.research'));
  await waitFor(() => expect(searches()).toHaveLength(1));
};

describe('offering the search', () => {
  it('sends the goal and the axes it would fill', async () => {
    open();
    await lookUp();
    expect(searches()[0]?.body.axes).toEqual(['年収', '技術スタック']);
    expect(searches()[0]?.body.goal).toBe(PLANNED.goal);
  });

  it('does not search on its own — it costs a minute and reaches the web', async () => {
    open();
    await waitFor(() => screen.getByText('rapiAvatar.roadmap.research'));
    expect(searches()).toEqual([]);
  });

  it('is not offered when the goal is not a choice', async () => {
    // A plan with no axes has nothing to compare, so there is nothing to
    // look up and the button would only be a way to waste a minute.
    PLANNED.comparisonAxes = [];
    open();
    await waitFor(() => screen.getByText(/roadmap\.create:/));
    expect(screen.queryByText('rapiAvatar.roadmap.research')).toBeNull();
    PLANNED.comparisonAxes = ['年収', '技術スタック'];
  });
});

describe('what it shows', () => {
  it('links every candidate to the page it came from', async () => {
    open();
    await lookUp();
    const link = await screen.findByText('A社');
    expect(link.getAttribute('href')).toBe('https://example.com/a');
  });

  it('says how much of the table each one actually filled', async () => {
    // B社 filled one of two axes. Saying 2/2 for it would be the lie this
    // whole feature has to avoid.
    open();
    await lookUp();
    await screen.findByText('B社');
    expect(screen.getByText(/— 1\/2/)).toBeTruthy();
    expect(screen.getByText(/— 2\/2/)).toBeTruthy();
  });

  it('names the axes nothing was found for', async () => {
    FINDINGS.unresolvedAxes = ['技術スタック'];
    open();
    await lookUp();
    expect(await screen.findByText(/unresolvedAxes:技術スタック/)).toBeTruthy();
    FINDINGS.unresolvedAxes = [];
  });

  it('keeps the plan usable when the search fails', async () => {
    // The empty comparison table is still worth having; a failed lookup
    // must not take the roadmap down with it.
    researchFails = true;
    open();
    await lookUp();
    await waitFor(() => expect(screen.getByText(/roadmap\.create:/)).toBeTruthy());
  });
});

describe('what reaches the note', () => {
  it('carries the candidates and their sources into it', async () => {
    open();
    await lookUp();
    await screen.findByText('A社');
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(notes).toHaveLength(1));
    const body = notes[0]?.content ?? '';
    expect(body).toContain('[A社](https://example.com/a)');
    expect(body).toContain('600〜800万');
  });

  it('leaves the unfound cell empty in the note too', async () => {
    open();
    await lookUp();
    await screen.findByText('B社');
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(notes).toHaveLength(1));
    expect(notes[0]?.content ?? '').toContain('| [B社](https://example.com/b) | 350〜600万 |  |');
  });

  it('still writes the empty table when nothing was looked up', async () => {
    open();
    await waitFor(() => screen.getByText(/roadmap\.create:/));
    fireEvent.click(screen.getByText(/roadmap\.create:/));
    await waitFor(() => expect(notes).toHaveLength(1));
    const body = notes[0]?.content ?? '';
    expect(body).toContain('| 候補 | 年収 | 技術スタック |');
    expect(body).not.toContain('https://example.com');
  });
});
