/**
 * TaskWatch.test
 *
 * ラピ as a supervisor, in the only role she has for now: reading.
 *
 * The properties worth holding are that she reports the server's numbers and
 * not her own, that she says why each thing is on the list rather than just
 * that it is, that a count larger than the rows shown says so, and above all
 * that looking changes nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

import { TaskWatch } from '../TaskWatch';

let requests: { url: string; method: string }[] = [];
let survey: Record<string, unknown>;
let ok = true;

const task = (id: number, title: string, daysAgo: number) => ({
  id,
  title,
  status: 'todo',
  themeId: 1,
  dueDate: null,
  updatedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
});

beforeEach(() => {
  requests = [];
  ok = true;
  survey = {
    total: 4,
    categories: [
      { category: 'held', total: 3, tasks: [task(11, '保留されたまま', 15)] },
      { category: 'noTheme', total: 0, tasks: [] },
      { category: 'blocked', total: 1, tasks: [task(12, 'ブロック中', 2)] },
      { category: 'stalled', total: 0, tasks: [] },
      { category: 'overdue', total: 0, tasks: [] },
    ],
  };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET' });
    return Promise.resolve({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(survey),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('looking over the backlog', () => {
  it('looks as soon as it is opened', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toContain('/assistant/supervision');
  });

  // The whole design: she reports the server's count, not one she worked out
  // from the rows she happens to be holding.
  it('reports the total the server gave', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.needHand:4')).toBeTruthy());
  });

  it('shows each category with its own count', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.category.held')).toBeTruthy());
    expect(screen.getByText('rapiAvatar.watch.category.blocked')).toBeTruthy();
  });

  // A list of titles with no reason attached is a list the reader has to
  // re-derive. The reason is the supervision.
  it('says why each category is on the list', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.why.held')).toBeTruthy());
  });

  // Empty categories are noise on a report whose job is to be short.
  it('leaves out the categories with nothing in them', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.category.held')).toBeTruthy());
    expect(screen.queryByText('rapiAvatar.watch.category.noTheme')).toBeNull();
    expect(screen.queryByText('rapiAvatar.watch.category.overdue')).toBeNull();
  });

  it('links each task with its header intact', async () => {
    render(<TaskWatch />);
    const link = await screen.findByText('保留されたまま');
    expect(link.getAttribute('href')).toBe('/tasks/11?showHeader=true');
  });

  // How long it has been waiting is the thing that makes a held task urgent;
  // one measured at fifteen days is the reason this category exists.
  it('says how long each one has been waiting', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.waitingDays:15')).toBeTruthy());
  });

  // Three matched, one shown: a count beside a shorter list reads as a
  // contradiction unless it is said.
  it('says when a category holds more than it shows', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.showing:1')).toBeTruthy());
  });

  // "Nothing needs you" has to be sayable, or an empty report looks broken —
  // the same hole the bulk-cleanup preview had.
  it('says plainly when nothing needs a hand', async () => {
    survey = {
      total: 0,
      categories: [{ category: 'held', total: 0, tasks: [] }],
    };
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.allClear')).toBeTruthy());
    expect(screen.queryByText(/needHand/)).toBeNull();
  });

  it('says so when it cannot look', async () => {
    ok = false;
    render(<TaskWatch />);
    await waitFor(() => expect(screen.getByText('rapiAvatar.watch.failed')).toBeTruthy());
  });

  it('can be asked to look again', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(screen.getByText('rapiAvatar.watch.again'));
    await waitFor(() => expect(requests).toHaveLength(2));
  });

  // The capability declares `writes: false`, and this is what that means on
  // screen: nothing it does can change anything.
  it('never asks the server to change anything', async () => {
    render(<TaskWatch />);
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(screen.getByText('rapiAvatar.watch.again'));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });
});
