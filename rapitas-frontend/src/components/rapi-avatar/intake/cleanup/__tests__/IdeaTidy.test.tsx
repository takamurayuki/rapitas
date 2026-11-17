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

beforeEach(() => {
  posts.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
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
