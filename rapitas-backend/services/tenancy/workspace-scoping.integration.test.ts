/**
 * workspace-scoping.integration.test
 *
 * Does the workspace extension actually scope a real Prisma client?
 *
 * The unit tests around it do not answer that, and the reason is worth
 * recording: they drive the extension through a fake handler that calls the
 * hook synchronously, so the AsyncLocalStorage scope is still on the stack
 * when the hook reads it. A real client reads it after a microtask. Measured
 * 2026-10-28, `storage.run(store, () => client.count())` lost the context
 * there and returned every workspace's rows while all nine unit tests stayed
 * green — so the whole layer was inert and nothing said so.
 *
 * This runs the real client against a throwaway SQLite database (see
 * workspace-scoping-probe.ts, which does the measuring in a subprocess) and
 * judges the numbers here.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spawning bun, generating a client and opening SQLite exceeds the 5s default
// under suite load on Windows.
const PROBE_TIMEOUT_MS = 120_000;

interface Probe {
  seeded: number;
  countNoWorkspace: number;
  countInWorkspace: number;
  countEscaped: number;
  findManyInWorkspace: number;
  findUniqueInWorkspace: string | null;
  findUniqueNoWorkspace: string | null;
  createdWorkspaceId: number | null;
  taskIsOwned: boolean;
  countTaskInWorkspace: number;
  countTaskNoWorkspace: number;
  upsertCreatedWorkspaceId: number | null;
  upsertCreatedName: string;
  upsertSecondCallSameRow: boolean;
  upsertSecondCallName: string;
  upsertRowsInWorkspace: number;
  seededRowNameAfterUpsert: string | null;
  /** A row's taskTitle, null when scoped away, or `{ error }` when refused. */
  compoundFindUniqueInWorkspace: string | null | { error: string };
  compoundFindUniqueOutsideHidden: string | null | { error: string };
  compoundFindUniqueNoWorkspace: string | null | { error: string };
  compoundFindUniqueOutsideNoWorkspace: string | null | { error: string };
}

let probe: Probe;
let workDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'workspace-scoping-'));
  const outPath = join(workDir, 'probe.json');
  const script = join(import.meta.dir, 'workspace-scoping-probe.ts');
  const child = Bun.spawn([process.execPath, 'run', script, outPath], {
    cwd: join(import.meta.dir, '..', '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(`probe failed (exit ${code})\nstdout:\n${out}\nstderr:\n${err}`);
  }
  probe = JSON.parse(readFileSync(outPath, 'utf8')) as Probe;
}, PROBE_TIMEOUT_MS);

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('a real client, scoped', () => {
  test('the probe measured a populated database, not an empty one', () => {
    expect(probe.seeded).toBe(3);
    expect(probe.countNoWorkspace).toBe(4);
  });

  test('reads inside a workspace see only that workspace', () => {
    expect(probe.countInWorkspace).toBe(1);
    expect(probe.findManyInWorkspace).toBe(1);
  });

  test('a unique read is rewritten, so it cannot reach another workspace', () => {
    expect(probe.findUniqueInWorkspace).toBeNull();
    // The control: the same read with no workspace finds the row. Without it,
    // the assertion above would also hold on a client that cannot read.
    expect(probe.findUniqueNoWorkspace).toBe('found');
  });

  test('create stamps the current workspace', () => {
    expect(probe.createdWorkspaceId).toBe(99);
  });

  describe('upsert, performed by the adapter because Prisma cannot scope it', () => {
    test('it runs, and the row it creates belongs to the workspace', () => {
      expect(probe.upsertCreatedWorkspaceId).toBe(99);
      expect(probe.upsertCreatedName).toBe('upserted-in-99');
    });

    test('it cannot reach a row outside the workspace', () => {
      // The upsert was pointed at id 1, a seeded row with no workspace, with
      // update data that would have renamed it. It must have created its own
      // row instead and left that one alone.
      expect(probe.seededRowNameAfterUpsert).toBe('alpha');
    });

    test('a second call on its own row updates it instead of creating another', () => {
      expect(probe.upsertSecondCallSameRow).toBe(true);
      expect(probe.upsertSecondCallName).toBe('updated-in-99');
      // create('made-in-99') plus the upserted row — and nothing else.
      expect(probe.upsertRowsInWorkspace).toBe(2);
    });
  });

  test('the generated client is current — regenerate it if this is the failure', () => {
    // The owned-model registry is read from the generated client's DMMF, not
    // from prisma/schema. After a schema change the client is stale until the
    // dev server restarts (dev.js runs db:generate) or CI runs prisma
    // generate, and while it is stale Task is not scoped and the next two
    // assertions measure nothing. This is the only place that says so.
    expect(probe.taskIsOwned).toBe(true);
  });

  test('Task is scoped, so an unowned row is invisible inside a workspace', () => {
    // Stage 1 gave Task no column on the premise that it inherits its
    // workspace through Category -> Theme. Prisma does not walk a foreign key
    // when it filters, so that read returned every workspace's tasks. This is
    // the assertion that premise failed.
    expect(probe.countTaskInWorkspace).toBe(0);
    // The control: the row exists and is readable, just not from in there.
    expect(probe.countTaskNoWorkspace).toBe(1);
  });

  test('runAcrossAllWorkspaces escapes the scope on purpose', () => {
    expect(probe.countEscaped).toBe(probe.countNoWorkspace);
  });

  // Every other probe keys on the single scalar `id`, so none of them could
  // catch #1307: findUnique takes a compound unique only as a nested shorthand
  // key, the rewrite to findFirst copied it across verbatim, and Prisma
  // rejected the query — which 500'd every task completion. A `{ error }` here
  // means the query was refused rather than the row being absent.
  test('a compound unique survives the rewrite against a real client', () => {
    expect(probe.compoundFindUniqueInWorkspace).toBe('compound-in-99');
  });

  test('a compound-unique read still cannot leave the workspace', () => {
    // null, not an error: the row is there, the scope is what hides it.
    expect(probe.compoundFindUniqueOutsideHidden).toBeNull();
  });

  test('the controls prove the compound read works at all', () => {
    expect(probe.compoundFindUniqueNoWorkspace).toBe('compound-in-99');
    expect(probe.compoundFindUniqueOutsideNoWorkspace).toBe('compound-outside');
  });

  test('no workspace means no change, which is all of stage 2', () => {
    // Stage 2 ships inert: nothing calls runInWorkspace yet, so every existing
    // caller must see exactly what it saw before this layer existed.
    expect(probe.countNoWorkspace).toBe(probe.seeded + 1);
  });
});
