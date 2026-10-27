/**
 * workspace-extension adapter
 *
 * The decisions are enumerated in workspace-scope.test.ts. What is left to
 * check here is that the adapter carries each one out — in particular that a
 * unique read is RE-ISSUED as findFirst on the base client rather than passed
 * to `query`, which would hand Prisma a findUnique whose where contains a
 * non-unique field and throw.
 *
 * And that it is inert with no workspace in context, which is what makes
 * stage 2 safe to deploy.
 */
import { describe, it, expect, mock } from 'bun:test';
import { createWorkspaceExtension, type BaseClientLike } from './workspace-extension';
import { runInWorkspace, runAcrossAllWorkspaces } from './workspace-context';

const OWNED = new Set(['Note', 'Category']);
const WS = 42;

function harness() {
  const findFirst = mock((args: unknown) => Promise.resolve({ via: 'base.findFirst', args }));
  const findFirstOrThrow = mock((args: unknown) =>
    Promise.resolve({ via: 'base.findFirstOrThrow', args }),
  );
  const base: BaseClientLike = {
    note: { findFirst, findFirstOrThrow },
    category: { findFirst, findFirstOrThrow },
  };
  const ext = createWorkspaceExtension(OWNED, base);
  const query = mock((args: unknown) => Promise.resolve({ via: 'query', args }));
  const run = (model: string | undefined, operation: string, args: unknown) =>
    ext.query.$allModels.$allOperations({ model, operation, args, query });
  return { run, query, findFirst, findFirstOrThrow };
}

describe('with a workspace in context', () => {
  it('passes scoped args to query for a findMany', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () => h.run('Note', 'findMany', { where: { a: 1 } }));
    expect(out).toEqual({ via: 'query', args: { where: { a: 1, workspaceId: WS } } });
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it('re-issues findUnique as findFirst on the BASE client, not through query', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () => h.run('Note', 'findUnique', { where: { id: 3 } }));
    expect(out).toEqual({
      via: 'base.findFirst',
      args: { where: { id: 3, workspaceId: WS } },
    });
    // The load-bearing half: handing this to `query` would re-run findUnique
    // with a non-unique field in its where, which Prisma rejects.
    expect(h.query).not.toHaveBeenCalled();
  });

  it('re-issues findUniqueOrThrow as findFirstOrThrow', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () =>
      h.run('Category', 'findUniqueOrThrow', { where: { id: 1 } }),
    );
    expect((out as { via: string }).via).toBe('base.findFirstOrThrow');
  });

  it('stamps the workspace onto a create', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () => h.run('Note', 'create', { data: { t: 'x' } }));
    expect(out).toEqual({ via: 'query', args: { data: { t: 'x', workspaceId: WS } } });
  });

  it('throws on upsert instead of letting it cross workspaces', async () => {
    const h = harness();
    await expect(
      runInWorkspace(WS, () => h.run('Note', 'upsert', { where: { id: 1 } })),
    ).rejects.toThrow('[tenancy]');
  });

  it('leaves a model that inherits through its parent alone', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () => h.run('Task', 'findMany', { where: { id: 1 } }));
    expect(out).toEqual({ via: 'query', args: { where: { id: 1 } } });
  });

  it('explains itself when the base client cannot take the re-issue', async () => {
    const ext = createWorkspaceExtension(OWNED, {} as BaseClientLike);
    const query = mock(() => Promise.resolve(null));
    await expect(
      runInWorkspace(WS, () =>
        ext.query.$allModels.$allOperations({
          model: 'Note',
          operation: 'findUnique',
          args: { where: { id: 1 } },
          query,
        }),
      ),
    ).rejects.toThrow('no such operation on the base client');
  });
});

describe('with no workspace in context', () => {
  // NOTE: this is what makes stage 2 safe to deploy — nothing establishes a
  // workspace yet, so every call must behave exactly as before. Stage 3
  // inverts it.
  it('passes every call through untouched', async () => {
    const h = harness();
    for (const op of ['findMany', 'findUnique', 'create', 'upsert', 'deleteMany']) {
      const out = await h.run('Note', op, { where: { id: 1 } });
      expect(out).toEqual({ via: 'query', args: { where: { id: 1 } } });
    }
    expect(h.findFirst).not.toHaveBeenCalled();
  });

  it('runAcrossAllWorkspaces escapes an enclosing workspace on purpose', async () => {
    const h = harness();
    const out = await runInWorkspace(WS, () =>
      runAcrossAllWorkspaces(() => h.run('Note', 'findMany', { where: { id: 1 } })),
    );
    expect(out).toEqual({ via: 'query', args: { where: { id: 1 } } });
  });
});
