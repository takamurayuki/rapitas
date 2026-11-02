/**
 * use-task-change.test (#1119 stage 6)
 *
 * Proposing a change writes nothing; applying sends exactly the change on the
 * card, confirmed; undo sends the action id and reports which field was
 * edited since when the server refuses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskChange } from '../use-task-change';

let requests: { url: string; body: Record<string, unknown> | null }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

beforeEach(() => {
  requests = [];
  answers = {
    'update-draft': {
      status: 200,
      body: {
        proposal: {
          kind: 'proposal',
          taskId: 11,
          title: 'Fix the login bug',
          changes: { status: 'done' },
          reason: '直したと言っているので',
        },
      },
    },
    'task-update': {
      status: 200,
      body: { success: true, actionId: 5, before: { status: 'todo' } },
    },
    revert: { status: 200, body: { success: true } },
  };
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const key = url.endsWith('/revert')
      ? 'revert'
      : url.includes('update-draft')
        ? 'update-draft'
        : 'task-update';
    const a = answers[key];
    return Promise.resolve({
      ok: a.status < 400,
      status: a.status,
      json: () => Promise.resolve(a.body),
    } as Response);
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useTaskChange', () => {
  it('proposing calls only the draft endpoint', async () => {
    const { result } = renderHook(() => useTaskChange());
    await act(() => result.current.propose('ログインのバグ直した'));
    expect(requests.map((r) => r.url.split('/assistant/')[1])).toEqual(['update-draft']);
    expect(result.current.proposal?.taskId).toBe(11);
  });

  it('applying sends the card’s change, confirmed', async () => {
    const { result } = renderHook(() => useTaskChange());
    await act(() => result.current.propose('x'));
    await act(() => result.current.apply());
    expect(requests[1].body).toEqual({ taskId: 11, changes: { status: 'done' }, confirmed: true });
    expect(result.current.applied?.actionId).toBe(5);
  });

  it('undo sends the action id; a 409 names the field edited since', async () => {
    const { result } = renderHook(() => useTaskChange());
    await act(() => result.current.propose('x'));
    await act(() => result.current.apply());
    answers.revert = { status: 409, body: { success: false, conflicts: ['status'] } };
    await act(() => result.current.undo());
    expect(requests[2].body).toEqual({ actionId: 5 });
    await waitFor(() => expect(result.current.conflicts).toEqual(['status']));
    expect(result.current.undone).toBe(false);
  });

  it('a successful undo is reported', async () => {
    const { result } = renderHook(() => useTaskChange());
    await act(() => result.current.propose('x'));
    await act(() => result.current.apply());
    await act(() => result.current.undo());
    expect(result.current.undone).toBe(true);
  });

  it('an unclear proposal carries the reasons and offers nothing to apply', async () => {
    answers['update-draft'] = {
      status: 200,
      body: { proposal: { kind: 'unclear', unclear: ['どのタスクか分かりません'] } },
    };
    const { result } = renderHook(() => useTaskChange());
    await act(() => result.current.propose('あれ'));
    expect(result.current.proposal).toBeNull();
    expect(result.current.unclear).toEqual(['どのタスクか分かりません']);
  });
});
