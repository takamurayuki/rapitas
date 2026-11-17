/**
 * idea-tidy.routes.test
 *
 * The idea tidy's HTTP surface: the proposal reads, applying takes only
 * confirmed ids, and undo takes what applying returned.
 */
import { describe, expect, mock, test } from 'bun:test';

const proposeIdeaTidy = mock(async (_themeId?: number) => ({ duplicates: [], unneeded: [] }));
const applyIdeaTidy = mock(async (_req: unknown) => ({ archivedIds: [1], previousContents: [] }));
const undoIdeaTidy = mock(async (_done: unknown) => {});
const loadActiveIdeas = mock(async (_themeId?: number) => [{ id: 1 }]);
let judged: unknown = { duplicates: [], unneeded: [], considered: 1, unclear: [] };
const judgeIdeaTidy = mock(async (_ideas: unknown) => judged);
mock.module('../../services/memory/idea-tidy-judgement', () => ({
  judgeIdeaTidy,
  JUDGEMENT_WINDOW: 100,
}));
mock.module('../../services/memory/idea-tidy', () => ({
  proposeIdeaTidy,
  applyIdeaTidy,
  undoIdeaTidy,
  planIdeaTidy: () => ({ duplicates: [], unneeded: [] }),
  loadActiveIdeas,
}));

const { ideaTidyRoutes } = await import('./idea-tidy.routes');

const call = (method: string, path: string, body?: unknown) =>
  ideaTidyRoutes.handle(
    new Request(`http://local${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );

describe('idea tidy routes', () => {
  test('GET /idea-box/tidy/proposal passes the theme on', async () => {
    const res = await call('GET', '/idea-box/tidy/proposal?themeId=3');
    expect(res.status).toBe(200);
    expect(proposeIdeaTidy).toHaveBeenLastCalledWith(3);
  });

  // おまかせ (2026-11-17): the model reads the ideas; nothing usable is said so.
  test('mode=judgement asks the model with the active ideas', async () => {
    const res = await call('GET', '/idea-box/tidy/proposal?mode=judgement');
    expect(judgeIdeaTidy).toHaveBeenLastCalledWith([{ id: 1 }]);
    expect(await res.json()).toMatchObject({ success: true, available: true, considered: 1 });
  });

  test('mode=judgement says when the model gave nothing usable', async () => {
    judged = null;
    const res = await call('GET', '/idea-box/tidy/proposal?mode=judgement');
    expect(await res.json()).toEqual({
      success: true,
      available: false,
      duplicates: [],
      unneeded: [],
    });
    judged = { duplicates: [], unneeded: [], considered: 1, unclear: [] };
  });

  test('POST /idea-box/tidy applies the confirmed merges and archives', async () => {
    const res = await call('POST', '/idea-box/tidy', {
      merges: [{ keepId: 2, mergeIds: [1] }],
      archiveIds: [9],
    });
    expect(res.status).toBe(200);
    expect(applyIdeaTidy).toHaveBeenLastCalledWith({
      merges: [{ keepId: 2, mergeIds: [1] }],
      archiveIds: [9],
    });
    expect(await res.json()).toMatchObject({ success: true, archivedIds: [1] });
  });

  test('a non-integer id is refused', async () => {
    const res = await call('POST', '/idea-box/tidy', { archiveIds: ['x'] });
    expect(res.status).toBe(422);
  });

  test('POST /idea-box/tidy/undo restores', async () => {
    const res = await call('POST', '/idea-box/tidy/undo', {
      archivedIds: [1],
      previousContents: [{ id: 2, content: '本文' }],
    });
    expect(res.status).toBe(200);
    expect(undoIdeaTidy).toHaveBeenCalledTimes(1);
  });
});
