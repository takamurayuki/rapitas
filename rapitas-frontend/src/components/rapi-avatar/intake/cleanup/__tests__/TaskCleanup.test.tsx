/**
 * TaskCleanup.test
 *
 * The destructive half, from the outside. Asking which tasks to clear must
 * delete nothing; what is deleted must be what is still ticked, never what
 * was proposed; and every removal must offer the undo that the trash makes
 * possible.
 *
 * Asserted on the requests, not the render — a version that deleted while
 * showing the list would look identical.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vals?: Record<string, unknown>) =>
    vals ? `${ns}.${key}:${Object.values(vals).join(',')}` : `${ns}.${key}`,
}));

import { TaskCleanup } from '../TaskCleanup';

const CANDIDATES = [
  { id: 11, title: '重複: アバターを直す', status: 'todo', themeId: 1, reason: '内容が重複' },
  { id: 12, title: '古い調査', status: 'done', themeId: 1, reason: '完了済みで不要' },
];

let requests: { url: string; body: Record<string, unknown> | null }[] = [];
let proposal: Record<string, unknown> = {
  available: true,
  candidates: CANDIDATES,
  considered: 60,
  unclear: [],
};
let deleteResults: unknown = [
  { taskId: 11, outcome: 'deleted', trashId: 111 },
  { taskId: 12, outcome: 'deleted', trashId: 112 },
];

beforeEach(() => {
  requests = [];
  proposal = { available: true, candidates: CANDIDATES, considered: 60, unclear: [] };
  deleteResults = [
    { taskId: 11, outcome: 'deleted', trashId: 111 },
    { taskId: 12, outcome: 'deleted', trashId: 112 },
  ];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = url.includes('/delete-draft')
      ? proposal
      : url.includes('/task-delete')
        ? { results: deleteResults }
        : {};
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Requests that actually remove something. */
const deletes = () => requests.filter((r) => r.url.includes('/assistant/task-delete'));
/** Requests that restore something. */
const restores = () => requests.filter((r) => r.url.includes('/task-trash/'));

const ask = (what: string) => {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: what } });
  fireEvent.click(screen.getByText('rapiAvatar.cleanup.propose'));
};

describe('asking what to clear', () => {
  it('deletes nothing', async () => {
    render(<TaskCleanup />);
    ask('重複しているタスクを消して');
    await waitFor(() => expect(screen.getByText('重複: アバターを直す')).toBeTruthy());
    expect(deletes()).toEqual([]);
  });

  it('shows why each one was picked', async () => {
    render(<TaskCleanup />);
    ask('重複しているタスクを消して');
    await waitFor(() => expect(screen.getByText('内容が重複')).toBeTruthy());
  });

  // Saying "chosen from the 60 most recent" is honest; an unqualified list
  // implies it looked at everything.
  it('says how many it weighed', async () => {
    render(<TaskCleanup />);
    ask('片付けて');
    await waitFor(() => expect(screen.getByText('rapiAvatar.cleanup.weighed:60')).toBeTruthy());
  });

  it('says so when the AI could not be reached', async () => {
    proposal = { available: false, candidates: [], considered: 60, unclear: [] };
    render(<TaskCleanup />);
    ask('片付けて');
    await waitFor(() => expect(screen.getByText('rapiAvatar.cleanup.unavailable')).toBeTruthy());
  });
});

describe('confirming', () => {
  const toList = async () => {
    render(<TaskCleanup />);
    ask('重複しているタスクを消して');
    await waitFor(() => expect(screen.getByText('重複: アバターを直す')).toBeTruthy());
  };

  it('deletes only on an explicit press, carrying the confirmation', async () => {
    await toList();
    expect(deletes()).toEqual([]);
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.remove:2'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].body).toMatchObject({ confirmed: true, taskIds: [11, 12] });
  });

  // The list is a suggestion; what goes is what survived the user's review.
  it('deletes what is still ticked, not what was proposed', async () => {
    await toList();
    fireEvent.click(screen.getByLabelText('古い調査'));
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.remove:1'));
    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].body?.taskIds).toEqual([11]);
  });

  it('cannot be pressed once everything is unticked', async () => {
    await toList();
    fireEvent.click(screen.getByLabelText('重複: アバターを直す'));
    fireEvent.click(screen.getByLabelText('古い調査'));
    const button = screen.getByText('rapiAvatar.cleanup.remove:0').closest('button');
    expect(button?.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button!);
    expect(deletes()).toEqual([]);
  });

  it('throws the list away on cancel, deleting nothing', async () => {
    await toList();
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.cancel'));
    await waitFor(() => expect(screen.queryByText('重複: アバターを直す')).toBeNull());
    expect(deletes()).toEqual([]);
  });
});

describe('afterwards', () => {
  const toRemoved = async () => {
    render(<TaskCleanup />);
    ask('片付けて');
    await waitFor(() => expect(screen.getByText('重複: アバターを直す')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.remove:2'));
    await waitFor(() => expect(screen.getByText('rapiAvatar.cleanup.removed:2')).toBeTruthy());
  };

  // The capability only exists because this is possible.
  it('offers the undo, and restores every trash row', async () => {
    await toRemoved();
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.undo'));
    await waitFor(() => expect(restores()).toHaveLength(2));
    expect(restores().map((r) => r.url.split('/task-trash/')[1])).toEqual([
      '111/restore',
      '112/restore',
    ]);
  });

  it('reports what it could not remove instead of claiming it all went', async () => {
    deleteResults = [
      { taskId: 11, outcome: 'deleted', trashId: 111 },
      { taskId: 12, outcome: 'protected' },
    ];
    render(<TaskCleanup />);
    ask('片付けて');
    await waitFor(() => expect(screen.getByText('重複: アバターを直す')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.remove:2'));
    await waitFor(() => expect(screen.getByText('rapiAvatar.cleanup.keptBack:1')).toBeTruthy());
  });

  it('offers no undo for a task that was never deleted', async () => {
    deleteResults = [{ taskId: 11, outcome: 'protected' }];
    render(<TaskCleanup />);
    ask('片付けて');
    await waitFor(() => expect(screen.getByText('重複: アバターを直す')).toBeTruthy());
    fireEvent.click(screen.getByText('rapiAvatar.cleanup.remove:2'));
    await waitFor(() => expect(screen.getByText('rapiAvatar.cleanup.removed:0')).toBeTruthy());
    expect(screen.queryByText('rapiAvatar.cleanup.undo')).toBeNull();
  });
});
