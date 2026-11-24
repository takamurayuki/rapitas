/**
 * confirm-link-audit.test
 *
 * One audit line per answer with respondent, time and route; 180-day
 * retention (acceptance criterion 4 of task 1430).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CONFIRM_LINK_AUDIT_RETENTION_MS,
  appendConfirmLinkAudit,
  confirmLinkRoute,
  pruneOrphanConfirmLinkAudits,
  readConfirmLinkAudit,
  removeConfirmLinkAudit,
  type ConfirmLinkAuditEntry,
} from '../confirm-link-audit';

const NOW = 1_800_000_000_000;
let dir: string;

function entry(at: number, linkId = 'abc'): ConfirmLinkAuditEntry {
  return {
    id: `id-${at}`,
    at: new Date(at).toISOString(),
    linkId,
    taskId: 1,
    pauseTransitionId: 10,
    questionId: 'Q1',
    selectedKey: 'A',
    respondentName: '山田 花子',
    route: confirmLinkRoute(linkId),
    questionDigest: 'd1',
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-audit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('confirm-link audit', () => {
  test('the route is the fixed name plus the link id', () => {
    expect(confirmLinkRoute('L1')).toBe('external_confirm_link:L1');
  });

  test('one append writes exactly one line with name, time and route', async () => {
    await appendConfirmLinkAudit(entry(NOW), { dir, now: NOW });
    const lines = readFileSync(join(dir, 'audit.ndjson'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as ConfirmLinkAuditEntry;
    expect(parsed.respondentName).toBe('山田 花子');
    expect(parsed.at).toBe(new Date(NOW).toISOString());
    expect(parsed.route).toBe('external_confirm_link:abc');
  });

  test('lines older than 180 days are dropped on append', async () => {
    const old = NOW - CONFIRM_LINK_AUDIT_RETENTION_MS - 86_400_000;
    writeFileSync(join(dir, 'audit.ndjson'), `${JSON.stringify(entry(old, 'old'))}\n`);
    await appendConfirmLinkAudit(entry(NOW, 'new'), { dir, now: NOW });
    const all = await readConfirmLinkAudit({ dir });
    expect(all.map((e) => e.linkId)).toEqual(['new']);
  });

  test('retention is 180 days', () => {
    expect(CONFIRM_LINK_AUDIT_RETENTION_MS).toBe(180 * 86_400_000);
  });
  test('appending the same id twice keeps one line', async () => {
    await appendConfirmLinkAudit(entry(NOW), { dir, now: NOW });
    await appendConfirmLinkAudit(entry(NOW), { dir, now: NOW });
    expect(await readConfirmLinkAudit({ dir })).toHaveLength(1);
  });

  test('removeConfirmLinkAudit deletes the line by id', async () => {
    await appendConfirmLinkAudit(entry(NOW), { dir, now: NOW });
    await removeConfirmLinkAudit(entry(NOW).id, { dir });
    expect(await readConfirmLinkAudit({ dir })).toHaveLength(0);
  });

  test('pruning drops only the lines judged orphan', async () => {
    await appendConfirmLinkAudit(entry(NOW, 'orphan'), { dir, now: NOW });
    await appendConfirmLinkAudit(entry(NOW + 1, 'answering'), { dir, now: NOW });
    const states: Record<string, string> = { orphan: 'revoked', answering: 'answering' };
    await pruneOrphanConfirmLinkAudits(
      async (e) => states[e.linkId] === 'active' || states[e.linkId] === 'revoked',
      { dir },
    );
    expect((await readConfirmLinkAudit({ dir })).map((e) => e.linkId)).toEqual(['answering']);
  });

  test('an append waits for a running prune, so a fresh line is never judged mid-write', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const prune = pruneOrphanConfirmLinkAudits(
      async () => {
        await gate;
        return true;
      },
      { dir },
    );
    const append = appendConfirmLinkAudit(entry(NOW, 'late'), { dir, now: NOW });
    release();
    await Promise.all([prune, append]);
    expect((await readConfirmLinkAudit({ dir })).map((e) => e.linkId)).toEqual(['late']);
  });
});
