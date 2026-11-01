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

/**
 * Build the adapter over a fake base client.
 *
 * @param opts - `found` is what findFirst returns (null = no such row), and
 *   `createThrows` an error for the create branch to raise / 探索結果と create の例外
 * @returns The runner and the mocks it drove / 実行関数と各モック
 */
function harness(opts: { found?: unknown; createThrows?: unknown } = {}) {
  const found = 'found' in opts ? opts.found : { via: 'base.findFirst' };
  const findFirst = mock((args: unknown) =>
    Promise.resolve(found === null ? null : { ...(found as object), args }),
  );
  const findFirstOrThrow = mock((args: unknown) =>
    Promise.resolve({ via: 'base.findFirstOrThrow', args }),
  );
  const update = mock((args: unknown) => Promise.resolve({ via: 'base.update', args }));
  const create = mock((args: unknown) =>
    opts.createThrows === undefined
      ? Promise.resolve({ via: 'base.create', args })
      : Promise.reject(opts.createThrows),
  );
  const delegate = { findFirst, findFirstOrThrow, update, create };
  const base: BaseClientLike = { note: delegate, category: delegate };
  const ext = createWorkspaceExtension(OWNED, base);
  const query = mock((args: unknown) => Promise.resolve({ via: 'query', args }));
  const run = (model: string | undefined, operation: string, args: unknown) =>
    ext.query.$allModels.$allOperations({ model, operation, args, query });
  return { run, query, findFirst, findFirstOrThrow, update, create };
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

  describe('upsert, which Prisma cannot scope and this adapter performs itself', () => {
    const args = {
      where: { slug: 'x' },
      create: { slug: 'x', t: 'new' },
      update: { t: 'changed' },
    };

    it('updates the row it finds, by id, never by the caller’s where', async () => {
      const h = harness({ found: { id: 7 } });
      const out = await runInWorkspace(WS, () => h.run('Note', 'upsert', args));
      expect(h.findFirst).toHaveBeenCalledWith({
        where: { slug: 'x', workspaceId: WS },
        select: { id: true },
      });
      expect(out).toEqual({
        via: 'base.update',
        args: { where: { id: 7 }, data: { t: 'changed' } },
      });
      expect(h.create).not.toHaveBeenCalled();
      // Going through `query` would hand Prisma the unscoped upsert back.
      expect(h.query).not.toHaveBeenCalled();
    });

    it('creates with the workspace stamped on when nothing is there', async () => {
      const h = harness({ found: null });
      const out = await runInWorkspace(WS, () => h.run('Note', 'upsert', args));
      expect(out).toEqual({
        via: 'base.create',
        args: { data: { slug: 'x', t: 'new', workspaceId: WS } },
      });
      expect(h.update).not.toHaveBeenCalled();
    });

    it('turns a lost race into the update branch', async () => {
      // findFirst saw nothing, then the create hit the unique constraint:
      // another caller created the row in between. A real upsert updates it,
      // so this must too rather than surfacing P2002 to the caller.
      let calls = 0;
      const h = harness({ found: null, createThrows: { code: 'P2002' } });
      const findFirst = mock(() => Promise.resolve(calls++ === 0 ? null : { id: 9 }));
      const base: BaseClientLike = {
        note: { findFirst, update: h.update, create: h.create },
      };
      const ext = createWorkspaceExtension(OWNED, base);
      const out = await runInWorkspace(WS, () =>
        ext.query.$allModels.$allOperations({
          model: 'Note',
          operation: 'upsert',
          args,
          query: h.query,
        }),
      );
      expect(out).toEqual({
        via: 'base.update',
        args: { where: { id: 9 }, data: { t: 'changed' } },
      });
    });

    it('reports a create failure that is not a lost race', async () => {
      const h = harness({ found: null, createThrows: new Error('disk on fire') });
      await expect(runInWorkspace(WS, () => h.run('Note', 'upsert', args))).rejects.toThrow(
        'disk on fire',
      );
    });

    it('reports P2002 as itself when the row is still not in this workspace', async () => {
      // The constraint fired, but a re-read inside the workspace still finds
      // nothing: the collision was with a constraint that is not workspace
      // aware, and pretending it was a race would hide that.
      const h = harness({ found: null, createThrows: { code: 'P2002' } });
      await expect(runInWorkspace(WS, () => h.run('Note', 'upsert', args))).rejects.toMatchObject({
        code: 'P2002',
      });
    });
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
