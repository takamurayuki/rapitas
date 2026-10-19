/**
 * use-task-draft.test
 *
 * ラピ proposes; the user files. The property worth protecting is the gap
 * between those two: asking for a draft must never create anything, and what
 * is filed must be what the user approved rather than what was proposed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import { useTaskDraft } from '../use-task-draft';
import type { TaskDraft } from '../task-draft-types';

const DRAFT: TaskDraft = {
  title: 'アバターを直す',
  description: 'rapitas のアバターを直す 2時間',
  estimatedHours: 2,
  themeId: 1,
  themeCandidates: [{ id: 1, name: 'rapitas' }],
  missing: [],
  reasons: { theme: { code: 'matchedThemeName', value: 'rapitas' } },
};

/** Every request the hook made, in order. */
let requests: { url: string; method: string; body: Record<string, unknown> | null }[] = [];

/** What the next `/tasks` POST should answer with. */
let fileResponse: { ok: boolean; body: unknown } = { ok: true, body: { id: 42 } };

/** What the next `/assistant/task-draft` POST should answer with. */
let draftResponse: { ok: boolean; body: unknown } = { ok: true, body: { draft: DRAFT } };

beforeEach(() => {
  requests = [];
  fileResponse = { ok: true, body: { id: 42 } };
  draftResponse = { ok: true, body: { draft: DRAFT } };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const answer = url.includes('/assistant/task-draft') ? draftResponse : fileResponse;
    return Promise.resolve({
      ok: answer.ok,
      status: answer.ok ? 200 : 500,
      json: () => Promise.resolve(answer.body),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The requests that would create something. */
const writes = () => requests.filter((r) => r.method === 'POST' && /\/tasks$/.test(r.url));

describe('asking for a draft', () => {
  it('creates nothing', async () => {
    const { result } = renderHook(() => useTaskDraft());
    await act(async () => {
      await result.current.propose('rapitas のアバターを直す 2時間');
    });
    expect(writes()).toEqual([]);
    expect(result.current.draft?.title).toBe('アバターを直す');
  });

  it('does not ask on empty text', async () => {
    const { result } = renderHook(() => useTaskDraft());
    await act(async () => {
      await result.current.propose('   ');
    });
    expect(requests).toEqual([]);
  });

  it('reports a failure instead of pretending it worked', async () => {
    draftResponse = { ok: false, body: {} };
    const { result } = renderHook(() => useTaskDraft());
    await act(async () => {
      await result.current.propose('なにか');
    });
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.draft).toBeNull();
  });
});

describe('filing', () => {
  const withDraft = async () => {
    const hook = renderHook(() => useTaskDraft());
    await act(async () => {
      await hook.result.current.propose('rapitas のアバターを直す 2時間');
    });
    return hook;
  };

  it('sends what the user approved, not what was proposed', async () => {
    const { result } = await withDraft();
    act(() => result.current.edit({ title: '書き直したタイトル' }));
    await act(async () => {
      await result.current.file();
    });
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toMatchObject({
      title: '書き直したタイトル',
      themeId: 1,
      status: 'todo',
    });
  });

  it('keeps the whole utterance as the description', async () => {
    const { result } = await withDraft();
    await act(async () => {
      await result.current.file();
    });
    expect(writes()[0].body?.description).toBe('rapitas のアバターを直す 2時間');
  });

  it('reports the created task so the UI can link to it', async () => {
    const { result } = await withDraft();
    await act(async () => {
      await result.current.file();
    });
    await waitFor(() => expect(result.current.filedTaskId).toBe(42));
  });

  // The gate: a task always belongs to a theme, and ラピ will not pick one for
  // the user. Pressing file before they have is a no-op, not a guess.
  it('refuses while the theme is undecided', async () => {
    draftResponse = {
      ok: true,
      body: {
        draft: {
          ...DRAFT,
          themeId: undefined,
          missing: ['theme'],
          themeCandidates: [
            { id: 1, name: 'rapitas' },
            { id: 2, name: '健康' },
          ],
        },
      },
    };
    const { result } = await withDraft();
    expect(result.current.fileable).toBe(false);
    await act(async () => {
      await result.current.file();
    });
    expect(writes()).toEqual([]);
  });

  it('becomes fileable once the user picks the theme', async () => {
    draftResponse = {
      ok: true,
      body: { draft: { ...DRAFT, themeId: undefined, missing: ['theme'] } },
    };
    const { result } = await withDraft();
    act(() => result.current.edit({ themeId: 2 }));
    await waitFor(() => expect(result.current.fileable).toBe(true));
    await act(async () => {
      await result.current.file();
    });
    expect(writes()[0].body?.themeId).toBe(2);
  });

  it('refuses when the title has been emptied', async () => {
    const { result } = await withDraft();
    act(() => result.current.edit({ title: '  ' }));
    await waitFor(() => expect(result.current.fileable).toBe(false));
    await act(async () => {
      await result.current.file();
    });
    expect(writes()).toEqual([]);
  });
});

describe('starting over', () => {
  it('drops the draft', async () => {
    const { result } = renderHook(() => useTaskDraft());
    await act(async () => {
      await result.current.propose('rapitas のアバターを直す');
    });
    act(() => result.current.reset());
    expect(result.current.draft).toBeNull();
  });
});
