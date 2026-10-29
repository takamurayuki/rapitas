/**
 * workspace-backfill.integration.test
 *
 * Does claiming the pre-tenancy rows preserve them, or only relabel them?
 *
 * The question is not academic. `POST /tenancy/claim` is how a live install
 * hands its existing data to its first workspace, and on this database that is
 * 148,191 rows across 92 models — 53 of which carry `@updatedAt`. Prisma fires
 * `@updatedAt` on `updateMany`, so a claim written that way stamps every one of
 * those rows with the moment the button was pressed: "recently updated" on the
 * task list, the knowledge ledger and the activity log all collapse into one
 * timestamp, and the real history is gone with no way back.
 *
 * So the ownership write has to be the one thing Prisma's own update cannot
 * be: a write that touches `workspaceId` and nothing else.
 *
 * NOT responsible for who should receive the rows (workspace-provisioning) or
 * for whether a scoped read can see them (workspace-scoping.integration).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spawning bun, opening SQLite and sweeping every owned model exceeds the 5s
// default under suite load on Windows.
const PROBE_TIMEOUT_MS = 120_000;

interface Probe {
  seededUnowned: number;
  oldUpdatedAt: number;
  unownedCategoryBefore: number;
  claimedCategory: number;
  firstFailed: string[];
  secondTotalClaimed: number;
  updatedAtBefore: number | null;
  updatedAtAfter: number | null;
  categoriesStillOwnedByOther: number;
}

let probe: Probe;
let workDir: string;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), 'workspace-backfill-'));
  const outPath = join(workDir, 'probe.json');
  const script = join(import.meta.dir, 'workspace-backfill-probe.ts');
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

describe('claiming the pre-tenancy rows', () => {
  test('the probe had unowned rows to claim — otherwise every assertion is free', () => {
    expect(probe.unownedCategoryBefore).toBe(probe.seededUnowned);
    expect(probe.claimedCategory).toBe(probe.seededUnowned);
  });

  test('no model failed, so a zero elsewhere means "nothing to do", not "it broke"', () => {
    expect(probe.firstFailed).toEqual([]);
  });

  test('updatedAt is left exactly as it was', () => {
    // The whole point: the stored value is still the seeded one, to the ms.
    expect(probe.updatedAtBefore).toBe(probe.oldUpdatedAt);
    expect(probe.updatedAtAfter).toBe(probe.oldUpdatedAt);
  });

  test('a second run finds nothing, so the endpoint is safe to press twice', () => {
    expect(probe.secondTotalClaimed).toBe(0);
  });

  test('a row another workspace owns is not taken from them', () => {
    expect(probe.categoriesStillOwnedByOther).toBe(1);
  });
});
