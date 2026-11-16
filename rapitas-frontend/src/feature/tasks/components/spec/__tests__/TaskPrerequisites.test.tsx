/**
 * TaskPrerequisites.test
 *
 * The tasks a task waits for (#1559), as the detail shows and edits them:
 * each with whether it is done, picked by searching titles or a number
 * instead of typing task numbers, removed one at a time, and a refusal from
 * the server (a cycle, an unknown task) shown as the server words it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const showToast = vi.fn();
vi.mock('@/components/ui/toast/ToastContainer', () => ({ useToast: () => ({ showToast }) }));

import { TaskPrerequisites, parseTaskNumbers } from '../TaskPrerequisites';

const puts: unknown[] = [];
let putStatus = 200;
const searches: string[] = [];

beforeEach(() => {
  puts.length = 0;
  searches.length = 0;
  putStatus = 200;
  showToast.mockReset();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { dependsOn: number[] };
      puts.push(body);
      const known: Record<number, { id: number; title: string; status: string }> = {
        12: { id: 12, title: 'API', status: 'done' },
        13: { id: 13, title: '画面', status: 'todo' },
      };
      return new Response(
        JSON.stringify(
          putStatus === 200
            ? { prerequisites: body.dependsOn.map((id) => known[id]) }
            : { error: 'お互いを待つことになり、どれも始められません' },
        ),
        { status: putStatus },
      );
    }
    if (url.includes('/tasks/search')) {
      searches.push(new URL(url).searchParams.get('q') ?? '');
      return new Response(
        JSON.stringify([
          { id: 20, title: '自分自身', status: 'todo' },
          { id: 12, title: 'API', status: 'done' },
          { id: 13, title: '画面', status: 'todo' },
        ]),
        { status: 200 },
      );
    }
    if (/\/tasks\/13$/.test(url)) {
      return new Response(JSON.stringify({ id: 13, title: '画面', status: 'todo' }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ prerequisites: [{ id: 12, title: 'API', status: 'done' }] }),
      { status: 200 },
    );
  });
});

async function renderLoaded() {
  await act(async () => {
    render(<TaskPrerequisites taskId={20} />);
  });
}

async function search(text: string) {
  vi.useFakeTimers();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  vi.useRealTimers();
}

describe('reading task numbers', () => {
  it('takes numbers with or without #, separated any way, once each', () => {
    expect(parseTaskNumbers('12, #13 14、12 x')).toEqual([12, 13, 14]);
  });
});

describe('the prerequisites in the detail', () => {
  it('lists each one with whether it is done', async () => {
    await renderLoaded();
    const row = document.querySelector('[data-prerequisite="12"]') as HTMLElement;
    expect(row.textContent).toContain('API');
    expect(row.textContent).toContain('prerequisiteDone');
  });

  it('finds tasks by title, leaving out itself and those already added', async () => {
    await renderLoaded();
    await search('画面');
    expect(searches).toEqual(['画面']);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(1);
    expect(options[0]).toContain('画面');
  });

  it('adds the one picked and saves the whole list', async () => {
    await renderLoaded();
    await search('画面');
    await act(async () => {
      fireEvent.click(screen.getByRole('option'));
    });
    expect(puts).toEqual([{ dependsOn: [12, 13] }]);
    expect(document.querySelector('[data-prerequisite="13"]')).toBeTruthy();
  });

  it('finds a task by its number', async () => {
    await renderLoaded();
    await search('#13');
    expect(searches).toEqual([]);
    expect(screen.getByRole('option').textContent).toContain('画面');
  });

  it('removes one', async () => {
    await renderLoaded();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /prerequisitesRemove/ }));
    });
    expect(puts).toEqual([{ dependsOn: [] }]);
    expect(document.querySelector('[data-prerequisite="12"]')).toBeNull();
  });

  it('shows the server’s reason when it refuses, and keeps the list', async () => {
    putStatus = 400;
    await renderLoaded();
    await search('画面');
    await act(async () => {
      fireEvent.click(screen.getByRole('option'));
    });
    expect(showToast).toHaveBeenCalledWith('お互いを待つことになり、どれも始められません', 'error');
    expect(document.querySelector('[data-prerequisite="13"]')).toBeNull();
    expect(document.querySelector('[data-prerequisite="12"]')).toBeTruthy();
  });
});
