/**
 * IdeaTidy.test
 *
 * 「アイデアを整理して」 now opens this card instead of the task tidy
 * (2026-11-17). It reads the proposal at once, lists near-duplicates under the
 * one kept and ideas to put away, applies only what is still ticked, and can
 * undo what it did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

import { IdeaTidy } from '../IdeaTidy';

const posts: Array<{ url: string; body: unknown }> = [];
const gets: string[] = [];
let judgement: unknown = {
  success: true,
  available: true,
  considered: 92,
  unclear: [],
  duplicates: [
    {
      keepId: 5,
      reason: 'どちらも受け渡しを音で伝える案',
      ideas: [
        { id: 5, title: '定位音によるバトン受け渡しの通知', priority: 'high' },
        { id: 6, title: 'バトン受け渡し連動の集中サウンド', priority: 'high' },
      ],
    },
  ],
  unneeded: [{ id: 8, title: 'なんとなく便利にする', reason: 'judged', note: '中身が無い' }],
};

beforeEach(() => {
  posts.length = 0;
  gets.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!init?.method) gets.push(url);
    if (url.includes('mode=judgement')) {
      return new Response(JSON.stringify(judgement), { status: 200 });
    }
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({ success: true, archivedIds: [1, 9], previousContents: [] }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        duplicates: [
          {
            keepId: 2,
            ideas: [
              { id: 2, title: '検索ボックスを付けたい', priority: 'high' },
              { id: 1, title: '検索ボックスを付ける', priority: 'medium' },
            ],
          },
        ],
        unneeded: [
          { id: 9, title: 'タスク化済みのアイデア', reason: 'used' },
          { id: 7, title: '古い思いつき', reason: 'stale' },
        ],
      }),
      { status: 200 },
    );
  });
});

async function renderLoaded() {
  await act(async () => {
    render(<IdeaTidy />);
  });
}

describe('the idea tidy card', () => {
  it('shows the duplicates under the one kept, and the ideas to put away', async () => {
    await renderLoaded();
    const group = document.querySelector('[data-idea-group="2"]') as HTMLElement;
    expect(group.textContent).toContain('検索ボックスを付けたい');
    expect(group.textContent).toContain('検索ボックスを付ける');
    expect(screen.getByText('タスク化済みのアイデア')).toBeTruthy();
    expect(screen.getByText('reason.used')).toBeTruthy();
  });

  it('applies only what is still ticked', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: '古い思いつき' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply/ }));
    });
    expect(posts[0]).toEqual({
      url: 'http://test:3001/idea-box/tidy',
      body: { merges: [{ keepId: 2, mergeIds: [1] }], archiveIds: [9] },
    });
    expect(screen.getByText(/done/)).toBeTruthy();
  });

  it('can undo what it applied', async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /apply/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /undo/ }));
    });
    expect(posts[1]).toEqual({
      url: 'http://test:3001/idea-box/tidy/undo',
      body: { archivedIds: [1, 9], previousContents: [] },
    });
  });
});

// おまかせ (2026-11-17): the rules found nothing in the real idea box, so the
// model can read the ideas instead; its reasons are shown beside each one.
describe('おまかせ', () => {
  it('asks the model and shows why each one was proposed', async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'byJudgement' }));
    });
    expect(gets.at(-1)).toBe('http://test:3001/idea-box/tidy/proposal?mode=judgement');
    expect(screen.getByText('どちらも受け渡しを音で伝える案')).toBeTruthy();
    expect(screen.getByText('中身が無い')).toBeTruthy();
    expect(screen.getByText('considered:{"count":92}')).toBeTruthy();
  });

  it('says so when the model could not answer, rather than "nothing to tidy"', async () => {
    judgement = { success: true, available: false, duplicates: [], unneeded: [] };
    await renderLoaded();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'byJudgement' }));
    });
    expect(screen.getByText('unavailable')).toBeTruthy();
    expect(screen.queryByText('nothing')).toBeNull();
  });
});
