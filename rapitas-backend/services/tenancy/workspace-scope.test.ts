/**
 * workspace-scope enumeration
 *
 * The question this answers is not "does the happy path work" but "is there
 * any model/operation pair that reaches the database unscoped". With ~50
 * owned models and 19 operations that is 950 pairs, so it is enumerated
 * rather than sampled.
 *
 * The load-bearing assertion is the one that counts pairs left as
 * `passthrough`: a new Prisma operation, or a classification bucket someone
 * widens by accident, shows up there as an unscoped query on owned data.
 */
import { describe, it, expect } from 'bun:test';
import { MODEL_OPERATIONS, scopeOperation, type ScopeDecision } from './workspace-scope';

const WS = 7;
/** Stand-in for the real registry: the pure core must not care what is in it. */
const OWNED = new Set(['Category', 'KnowledgeEntry', 'TimelineEvent', 'Note', 'UserSettings']);
const NOT_OWNED = ['Task', 'Theme', 'Comment', 'TaskLabel', 'User'];

const decide = (model: string, operation: string, args: unknown = {}): ScopeDecision =>
  scopeOperation({ model, operation, args, workspaceId: WS, ownedModels: OWNED });

describe('nothing owned reaches the database unscoped', () => {
  // 5 models x 19 operations. Every pair must be handled on purpose: scoped,
  // rewritten, or refused. `passthrough` here would be an unscoped query.
  const pairs = [...OWNED].flatMap((m) => MODEL_OPERATIONS.map((o) => [m, o] as const));

  it('covers the whole matrix', () => {
    expect(pairs.length).toBe(OWNED.size * MODEL_OPERATIONS.length);
  });

  it('leaves no owned pair as a bare passthrough, except the Mongo-only raws', () => {
    const MONGO_ONLY = new Set(['aggregateRaw', 'findRaw']);
    const leaked = pairs
      .filter(([m, o]) => decide(m, o).kind === 'passthrough' && !MONGO_ONLY.has(o))
      .map(([m, o]) => `${m}.${o}`);
    expect(leaked).toEqual([]);
  });

  it.each(MODEL_OPERATIONS)('Category.%s is classified', (operation) => {
    const d = decide('Category', operation);
    expect(['scoped', 'rewritten', 'upsert', 'reject', 'passthrough']).toContain(d.kind);
  });
});

describe('reads', () => {
  it('adds the workspace to a findMany filter, keeping the caller’s own', () => {
    const d = decide('Note', 'findMany', { where: { title: 'x' } });
    expect(d).toEqual({ kind: 'scoped', args: { where: { title: 'x', workspaceId: WS } } });
  });

  it('adds one even when the caller passed no where at all', () => {
    expect(decide('Note', 'findMany')).toEqual({
      kind: 'scoped',
      args: { where: { workspaceId: WS } },
    });
  });

  it.each(['count', 'aggregate', 'groupBy'] as const)('%s is filtered too', (operation) => {
    const d = decide('TimelineEvent', operation, {});
    expect(d.kind).toBe('scoped');
    expect((d as { args: { where: unknown } }).args.where).toEqual({ workspaceId: WS });
  });
});

describe('findUnique is rewritten, not filtered', () => {
  // Prisma rejects a non-unique field in findUnique's where, so adding the
  // workspace there would make every such call throw. findFirst takes the
  // same filter and returns the same shape.
  it.each([
    ['findUnique', 'findFirst'],
    ['findUniqueOrThrow', 'findFirstOrThrow'],
  ] as const)('%s becomes %s', (from, to) => {
    const d = decide('Category', from, { where: { id: 3 } });
    expect(d).toEqual({
      kind: 'rewritten',
      operation: to,
      args: { where: { id: 3, workspaceId: WS } },
    });
  });
});

describe('writes', () => {
  it('stamps the workspace onto a create', () => {
    const d = decide('Note', 'create', { data: { title: 'x' } });
    expect(d).toEqual({ kind: 'scoped', args: { data: { title: 'x', workspaceId: WS } } });
  });

  it('stamps every row of a createMany', () => {
    const d = decide('Note', 'createMany', { data: [{ title: 'a' }, { title: 'b' }] });
    expect((d as { args: { data: unknown } }).args.data).toEqual([
      { title: 'a', workspaceId: WS },
      { title: 'b', workspaceId: WS },
    ]);
  });

  it.each(['update', 'updateMany', 'delete', 'deleteMany', 'updateManyAndReturn'] as const)(
    '%s can only reach rows in this workspace',
    (operation) => {
      const d = decide('Note', operation, { where: { id: 1 } });
      expect((d as { args: { where: unknown } }).args.where).toEqual({ id: 1, workspaceId: WS });
    },
  );

  describe('upsert', () => {
    // Stage 2 refused upsert, because its `where` takes only unique fields and
    // the workspace cannot be added to one. It left a note saying each of the
    // (then) 7 call sites needed an explicit findFirst + create/update. There
    // are 32 now, and a refusal is not inert: it throws for a logged-in user
    // on the workflow artifact save, auto-run start/stop, notes and the GitHub
    // sync. Doing the find-then-write HERE instead fixes all 32 at once, and
    // the workspace cannot be escaped on any of the three branches.
    const d = decide('Note', 'upsert', {
      where: { slug: 'x' },
      create: { slug: 'x', title: 'new' },
      update: { title: 'changed' },
      select: { id: true },
    });

    it('is emulated rather than refused', () => {
      expect(d.kind).toBe('upsert');
    });

    it('looks the row up inside the workspace', () => {
      expect((d as { where: unknown }).where).toEqual({ slug: 'x', workspaceId: WS });
    });

    it('stamps the workspace on the row it may create', () => {
      expect((d as { create: unknown }).create).toEqual({
        slug: 'x',
        title: 'new',
        workspaceId: WS,
      });
    });

    it('leaves the update data alone — the row is already in the workspace', () => {
      expect((d as { update: unknown }).update).toEqual({ title: 'changed' });
    });

    it('carries the caller’s own options through to the write', () => {
      expect((d as { rest: unknown }).rest).toEqual({ select: { id: true } });
    });

    it('cannot be told which workspace to write to', () => {
      // A caller passing someone else's workspace must not reach it, on either
      // branch. Without this, upsert would be the one hole in the layer.
      const forged = decide('Note', 'upsert', {
        where: { slug: 'x', workspaceId: WS + 1 },
        create: { slug: 'x', workspaceId: WS + 1 },
        update: {},
      });
      expect((forged as { where: { workspaceId: number } }).where.workspaceId).toBe(WS);
      expect((forged as { create: { workspaceId: number } }).create.workspaceId).toBe(WS);
    });
  });
});

describe('what it must NOT touch', () => {
  it.each(NOT_OWNED)('%s is passed through — it inherits via its parent', (model) => {
    expect(decide(model, 'findMany', { where: { id: 1 } })).toEqual({ kind: 'passthrough' });
  });

  it('passes everything through when no workspace is in context (stage 2 is inert)', () => {
    // NOTE: this is the assertion that makes stage 2 safe to deploy. It must
    // be INVERTED in stage 3, once a session always resolves a workspace.
    for (const operation of MODEL_OPERATIONS) {
      const d = scopeOperation({
        model: 'Note',
        operation,
        args: { where: { id: 1 } },
        workspaceId: null,
        ownedModels: OWNED,
      });
      expect(d).toEqual({ kind: 'passthrough' });
    }
  });

  it('does not mutate the args it was given', () => {
    const args = { where: { id: 1 } };
    decide('Note', 'findMany', args);
    expect(args).toEqual({ where: { id: 1 } });
  });
});

describe('an operation it has never heard of', () => {
  it('is refused, not run unscoped', () => {
    const d = decide('Note', 'findManyAndSomethingNew');
    expect(d.kind).toBe('reject');
    expect((d as { reason: string }).reason).toContain('not classified');
  });
});
