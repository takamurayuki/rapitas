/**
 * TaskRoadmap.milestones.test
 *
 * When ラピ's plan has milestones (節目), the steps are shown grouped under
 * them with each milestone's criteria, and creating the plan sends the
 * milestones and each step's milestone number — what was shown is what is
 * created, milestones included.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));
const noteState = {
  createNote: () => {},
  updateNote: () => {},
  currentNoteId: 'note-1',
};
vi.mock('@/stores/note-store', () => ({
  useNoteStore: Object.assign((selector: (s: typeof noteState) => unknown) => selector(noteState), {
    getState: () => noteState,
  }),
}));

import { TaskRoadmap } from '../TaskRoadmap';

const DRAFT = {
  goal: '基本情報に合格する',
  themeChoice: { kind: 'new', name: '学習', reason: 'なし' },
  projectChoice: { kind: 'existing', id: 7, name: '資格' },
  questions: [],
  milestones: [
    { name: '基礎固め', acceptanceCriteria: ['午前の過去問で7割'] },
    { name: '仕上げ', acceptanceCriteria: ['模試で合格点'], dueDate: '2026-12-20' },
  ],
  steps: [
    { title: 'テキストを1周', description: '1日1章', milestoneIndex: 0 },
    { title: '過去問3年分', description: '1日1回', milestoneIndex: 0 },
    { title: '模試を受ける', description: '1回', milestoneIndex: 1 },
    { title: '受験票を確認', description: '前日に' },
  ],
};

let requests: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url, body });
    const answer = String(url).includes('/commit')
      ? {
          themeId: 1,
          projectId: 7,
          taskIds: [1, 2, 3, 4],
          milestoneIds: [9, 10],
          failedAfter: null,
        }
      : { available: true, draft: DRAFT };
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(answer),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const show = () => render(<TaskRoadmap handedOver="資格を取りたい" />);

describe('a roadmap with milestones', () => {
  it('groups the steps under their milestone, with its criteria', async () => {
    show();
    const first = await screen.findByTestId('roadmap-milestone-0');
    expect(within(first).getByText('基礎固め')).toBeTruthy();
    expect(within(first).getByText('午前の過去問で7割')).toBeTruthy();
    expect(within(first).getByText('テキストを1周')).toBeTruthy();
    expect(within(first).getByText('過去問3年分')).toBeTruthy();
    expect(within(first).queryByText('模試を受ける')).toBeNull();

    const second = screen.getByTestId('roadmap-milestone-1');
    expect(within(second).getByText('模試を受ける')).toBeTruthy();
    expect(within(second).getByText('2026-12-20')).toBeTruthy();

    // A step with no milestone is still shown, outside every group.
    const loose = screen.getByText('受験票を確認');
    expect(first.contains(loose) || second.contains(loose)).toBe(false);
  });

  it('sends the milestones and each step milestone number when creating', async () => {
    show();
    // No questions, so there is no refine round: create straight away.
    fireEvent.click(await screen.findByText('rapiAvatar.roadmap.create:4'));
    await waitFor(() => expect(requests.some((r) => r.url.includes('/commit'))).toBe(true));
    const body = requests.find((r) => r.url.includes('/commit'))!.body;
    expect(body.milestones).toEqual(DRAFT.milestones);
    expect((body.steps as { milestoneIndex?: number }[]).map((s) => s.milestoneIndex)).toEqual([
      0,
      0,
      1,
      undefined,
    ]);
  });
});
