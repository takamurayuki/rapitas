/**
 * workspace-request.integration.test
 *
 * Two accounts, one server: does each one actually see only its own rows, and
 * does a request with no cookie still see everything?
 *
 * End to end against a real Elysia server and a real Prisma client, because
 * every link in this chain has already been observed passing its own unit test
 * while disconnected from the next, and the failure here is not an error — it
 * is one account quietly reading another's data.
 *
 * The concurrency case is not decoration. The first implementation of this
 * established the workspace with `AsyncLocalStorage.enterWith` from an Elysia
 * `onRequest` hook; it passed every sequential check and then, with five
 * overlapping requests, handed the cookieless one a neighbour's workspace.
 *
 * See workspace-request-probe.ts, which does the measuring in a subprocess.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spawning bun, booting Elysia and opening SQLite exceeds the 5s default under
// suite load on Windows.
const PROBE_TIMEOUT_MS = 120_000;

const ALICE = 'alice-only';
const BOB = 'bob-only';
const UNOWNED = 'pre-tenancy';
const EVERYTHING = [ALICE, BOB, UNOWNED];

interface Probe {
  alice: string[];
  bob: string[];
  noCookie: string[];
  expired: string[];
  unknown: string[];
  aliceAmongOthers: string[];
  noCookieAfterAlice: string[];
  concurrent: string[][];
  backfill: { claimed: number; aliceAfter: string[]; bobAfter: string[] };
}

let probe: Probe;
let workDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'workspace-request-'));
  const outPath = join(workDir, 'probe.json');
  const script = join(import.meta.dir, 'workspace-request-probe.ts');
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

describe('two accounts on one server', () => {
  test('each account sees only its own rows', () => {
    expect(probe.alice).toEqual([ALICE]);
    expect(probe.bob).toEqual([BOB]);
  });

  test('a request with no cookie sees everything, which is how the agent works', () => {
    // CLAUDE.md's workflow API is plain curl with no session. Scoping those
    // would stop auto-run dead, so unscoped is the deliberate behaviour — and
    // it doubles as the control proving the rows above exist at all.
    expect(probe.noCookie).toEqual(EVERYTHING);
  });

  test('an expired or unknown session is unscoped, never its former owner', () => {
    expect(probe.expired).toEqual(EVERYTHING);
    expect(probe.unknown).toEqual(EVERYTHING);
  });

  test('the session cookie is found among other cookies', () => {
    expect(probe.aliceAmongOthers).toEqual([ALICE]);
  });

  test('a cookieless request after a scoped one does not inherit it', () => {
    expect(probe.noCookieAfterAlice).toEqual(EVERYTHING);
  });

  test('overlapping requests stay isolated', () => {
    expect(probe.concurrent).toEqual([[ALICE], [BOB], EVERYTHING, [ALICE], [BOB]]);
  });
});

describe('claiming the rows that predate accounts', () => {
  test('moves the unowned row into the claiming workspace', () => {
    expect(probe.backfill.claimed).toBe(1);
    expect(probe.backfill.aliceAfter).toEqual([ALICE, UNOWNED]);
  });

  test('leaves the other workspace untouched', () => {
    // It only ever matches `workspaceId IS NULL`, so it cannot move a row
    // from one workspace to another however it is called.
    expect(probe.backfill.bobAfter).toEqual([BOB]);
  });
});
