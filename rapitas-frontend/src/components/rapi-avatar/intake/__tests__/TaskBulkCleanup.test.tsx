/**
 * TaskBulkCleanup.test
 *
 * Hundreds of tasks at once, which makes this the most destructive thing in
 * the panel. What has to hold: previewing removes nothing, the conditions
 * are never what gets deleted — the listed-and-ticked ids are — and a
 * clear-out larger than one call still comes back with a single undo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

import { TaskBulkCleanup } from '../TaskBulkCleanup';

let requests: { url: string; body: Record<string, unknown> | null }[] = [];
let matches: { id: number; title: string; status: string; updatedAt: string }[] = [];
let total = 0;
let truncated = false;
let excludedProtected = 0;

const makeMatches = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    title: `task ${i + 1}`,
    status: 'cancelled',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));

beforeEach(() => {
  requests = [];
  matches = makeMatches(3);
  total = 3;
  truncated = false;
  excludedProtected = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith('/themes')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ id: 1, name: 'rapitas' }]),
      } as Response);
    }
    if (url.includes('/delete-filter')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ matches, total, truncated, excludedProtected }),
      } as Response);
    }
    if (url.includes('/task-delete')) {
      const ids = (JSON.parse(String(init?.body)) as { taskIds: number[] }).taskIds;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: ids.map((id) => ({ taskId: id, outcome: 'deleted', trashId: 1000 + id })),
          }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

const deletes = () => requests.filter((r) => r.url.includes('/assistant/task-delete'));
const restores = () => requests.filter((r) => r.url.includes('/task-trash/'));

const count = async () => {
  fireEvent.click(screen.getByText('rapiAvatar.bulk.preview'));
  await waitFor(() => expect(screen.getByText(/rapiAvatar\.bulk\.matched/)).toBeTruthy());
};

describe('previewing', () => {
  it('removes nothing', async () => {
    render(<TaskBulkCleanup />);
    await count();
    expect(deletes()).toEqual([]);
  });

  it('sends the conditions that were set', async () => {
    render(<TaskBulkCleanup />);
    await count();
    const q = requests.find((r) => r.url.includes('/delete-filter'));
    expect(q?.body).toMatchObject({ statuses: ['cancelled'], updatedBeforeDays: 90 });
  });

  it('reports the full total even when the list is capped', async () => {
    matches = makeMatches(500);
    total = 719;
    truncated = true;
    render(<TaskBulkCleanup />);
    await count();
    expect(screen.getByText('rapiAvatar.bulk.matched:719')).toBeTruthy();
    expect(screen.getByText('rapiAvatar.bulk.truncated:500')).toBeTruthy();
  });

  it('says how many protected tasks it left out', async () => {
    excludedProtected = 4;
    render(<TaskBulkCleanup />);
    await count();
    expect(screen.getByText('rapiAvatar.bulk.protectedExcluded:4')).toBeTruthy();
  });
});

describe('removing', () => {
  // The conditions build a list; the list is what gets deleted. Nothing may
  // be removed that was not on screen.
  it('sends the listed ids, not the conditions', async () => {
    render(<TaskBulkCleanup />);
    await count();
    fireEvent.click(screen.getByText('rapiAvatar.bulk.remove:3'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].body).toMatchObject({ confirmed: true, taskIds: [1, 2, 3] });
  });

  it('drops the ones the user unticked', async () => {
    render(<TaskBulkCleanup />);
    await count();
    fireEvent.click(screen.getByLabelText('task 2'));
    fireEvent.click(screen.getByText('rapiAvatar.bulk.remove:2'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].body?.taskIds).toEqual([1, 3]);
  });

  // The delete route caps a call at 50; a clear-out of hundreds must still
  // be one action from the user's side.
  it('splits a large clear-out into batches of fifty', async () => {
    matches = makeMatches(120);
    total = 120;
    render(<TaskBulkCleanup />);
    await count();
    fireEvent.click(screen.getByText('rapiAvatar.bulk.remove:120'));
    await waitFor(() => expect(deletes()).toHaveLength(3));
    expect(deletes().map((d) => (d.body?.taskIds as number[]).length)).toEqual([50, 50, 20]);
  });

  it('cannot be pressed with nothing ticked', async () => {
    render(<TaskBulkCleanup />);
    await count();
    for (const id of [1, 2, 3]) fireEvent.click(screen.getByLabelText(`task ${id}`));
    const button = screen.getByText('rapiAvatar.bulk.remove:0').closest('button');
    expect(button?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button!);
    expect(deletes()).toEqual([]);
  });
});

describe('afterwards', () => {
  it('undoes every batch with one press', async () => {
    matches = makeMatches(120);
    total = 120;
    render(<TaskBulkCleanup />);
    await count();
    fireEvent.click(screen.getByText('rapiAvatar.bulk.remove:120'));
    await waitFor(() => expect(screen.getByText('rapiAvatar.bulk.removed:120')).toBeTruthy());

    fireEvent.click(screen.getByText('rapiAvatar.bulk.undo:120'));
    await waitFor(() => expect(restores()).toHaveLength(120));
  });
});
