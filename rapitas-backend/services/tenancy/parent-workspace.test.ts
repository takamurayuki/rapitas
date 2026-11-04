/**
 * parent-workspace
 *
 * A child row must land in its parent's workspace when nothing in context
 * would put it there, and must not be given a workspace its parent lacks.
 */
import { describe, test, expect, mock } from 'bun:test';
import { inheritWorkspace, readParentWorkspace } from './parent-workspace';

describe('inheritWorkspace', () => {
  test('copies a parent workspace', () => {
    expect(inheritWorkspace({ workspaceId: 1 })).toEqual({ workspaceId: 1 });
  });

  test('adds nothing for an unowned or missing parent', () => {
    expect(inheritWorkspace({ workspaceId: null })).toEqual({});
    expect(inheritWorkspace(null)).toEqual({});
    expect(inheritWorkspace(undefined)).toEqual({});
  });
});

describe('readParentWorkspace', () => {
  test('reads through findFirst on the client it is given', async () => {
    const findFirst = mock(() => Promise.resolve({ workspaceId: 3 }));
    const out = await readParentWorkspace({ task: { findFirst } }, 1152);
    expect(out).toEqual({ workspaceId: 3 });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 1152 },
      select: { workspaceId: true },
    });
  });

  test('adds nothing when the parent is gone', async () => {
    const findFirst = mock(() => Promise.resolve(null));
    expect(await readParentWorkspace({ task: { findFirst } }, 1)).toEqual({});
  });
});
