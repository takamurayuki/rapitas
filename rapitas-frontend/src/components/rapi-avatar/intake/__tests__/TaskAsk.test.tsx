/**
 * TaskAsk.test
 *
 * ラピ answering about the backlog. The property worth protecting is that
 * she reports what the server returned and nothing else — the model's part
 * was turning the question into a query, and the query is shown so a
 * misreading is visible rather than arriving as a confident wrong number.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

import { TaskAsk } from '../TaskAsk';

let requests: string[] = [];
let answer: Record<string, unknown> = {
  available: true,
  query: { themeId: 1, statuses: ['blocked'] },
  total: 7,
  rows: [
    { id: 11, title: 'ブロック中のひとつめ', status: 'blocked', priority: 'high', dueDate: null },
    { id: 12, title: 'ブロック中のふたつめ', status: 'blocked', priority: 'low', dueDate: null },
  ],
  unclear: [],
};

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', (url: string) => {
    requests.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(answer),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const ask = (what: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: what } });
  fireEvent.click(screen.getByText('rapiAvatar.ask.ask'));
};

describe('asking', () => {
  it('reports the count the server gave', async () => {
    render(<TaskAsk />);
    ask('ブロックされているのは？');
    await waitFor(() => expect(screen.getByText('rapiAvatar.ask.found:7')).toBeTruthy());
  });

  // Shown so a misread question is visible; otherwise a wrong answer to a
  // question nobody asked looks exactly like a right one.
  it('shows what the question was taken to mean', async () => {
    render(<TaskAsk />);
    ask('ブロックされているのは？');
    await waitFor(() => expect(screen.getByText('rapiAvatar.ask.readAs:blocked')).toBeTruthy());
  });

  it('lists the matches, linking each with its header intact', async () => {
    render(<TaskAsk />);
    ask('ブロックされているのは？');
    const link = await screen.findByText('ブロック中のひとつめ');
    expect(link.getAttribute('href')).toBe('/tasks/11?showHeader=true');
  });

  // Seven matched, two shown: saying only "7" with two rows under it reads
  // as a contradiction.
  it('says when it is showing fewer rows than it found', async () => {
    render(<TaskAsk />);
    ask('ブロックされているのは？');
    await waitFor(() => expect(screen.getByText('rapiAvatar.ask.showing:2')).toBeTruthy());
  });

  it('asks nothing on an empty question', () => {
    render(<TaskAsk />);
    const button = screen.getByText('rapiAvatar.ask.ask').closest('button');
    expect(button?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button!);
    expect(requests).toEqual([]);
  });

  // An answer of "0" would be a lie here; there is no answer at all.
  it('says the AI was unavailable rather than showing a zero', async () => {
    answer = { available: false };
    render(<TaskAsk />);
    ask('なにか');
    await waitFor(() => expect(screen.getByText('rapiAvatar.ask.unavailable')).toBeTruthy());
    expect(screen.queryByText(/rapiAvatar\.ask\.found/)).toBeNull();
  });
});
