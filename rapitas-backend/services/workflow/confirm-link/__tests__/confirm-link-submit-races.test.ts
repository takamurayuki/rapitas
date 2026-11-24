/**
 * confirm-link-submit-races.test
 *
 * Interleavings that must still leave exactly one audit line per applied
 * answer (acceptance criterion 4 of task 1430): a page view that read the
 * link before an answer was reserved, and a retry after both the audit
 * compensation and the orphan prune failed. Split out of
 * confirm-link-submit.test.ts to keep each file under 300 lines.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as fsPromises from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appendConfirmLinkAudit,
  pruneTaskOrphanAudits,
  readConfirmLinkAudit,
  removeConfirmLinkAudit,
} from '../confirm-link-audit';
import { issueConfirmLink, loadConfirmLinkView } from '../confirm-link-service';
import { createConfirmLinkStore, type ConfirmLinkStore } from '../confirm-link-store';
import { submitConfirmLinkAnswer } from '../confirm-link-submit';
import type { ConfirmLinkServiceDeps } from '../confirm-link-types';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const QUESTION_MD =
  '```json:options\n' +
  JSON.stringify({
    questions: [
      {
        id: 'Q1',
        summary: '配色はどちらにしますか',
        options: [
          { key: 'A', label: '青', consequence: '既定色を青にする' },
          { key: 'B', label: '緑' },
        ],
        freeTextRequired: false,
        recommended: 'A',
        recommendedReason: 'r',
      },
    ],
  }) +
  '\n```';

let dir: string;
let store: ConfirmLinkStore;
let snapshot: { workflowStatus: string | null; latestPauseId: number | null };
let deps: ConfirmLinkServiceDeps;
const applyAnswer = mock(async () => ({ kind: 'execution_continuation' }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-races-'));
  store = createConfirmLinkStore({ dir });
  snapshot = { workflowStatus: 'awaiting_question', latestPauseId: 10 };
  applyAnswer.mockReset().mockResolvedValue({ kind: 'execution_continuation' });
  deps = {
    store,
    secret: SECRET,
    publicOrigin: null,
    readTaskSnapshot: async () => snapshot,
    readQuestion: async () => QUESTION_MD,
    readResources: async () => [],
    applyAnswer,
    releaseHalt: async () => false,
    triggerReExecution: async () => {},
    appendAudit: (e) => appendConfirmLinkAudit(e, { dir }),
    removeAudit: (id) => removeConfirmLinkAudit(id, { dir }),
    pruneOrphanAudits: async (taskId) => {
      await pruneTaskOrphanAudits(taskId, store, { dir });
    },
    readResourceOwner: async () => null,
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function issue(): Promise<string> {
  const res = await issueConfirmLink({ taskId: 1, message: '', now: NOW }, deps);
  return res.url.split('/public/confirm-links/')[1];
}

function submit(token: string) {
  return submitConfirmLinkAnswer(
    { token, choice: 'A', respondentName: '外部 太郎', confirmed: true, now: NOW + 1000 },
    deps,
  );
}

const audits = () => readConfirmLinkAudit({ dir });
const linkState = async () => (await store.list(1))[0]?.state;

describe('confirm-link submit races', () => {
  test('R1: a page view that read the link before an answer does not revoke the answer', async () => {
    const token = await issue();
    const [link] = await store.list(1);
    // The view reads the link while it is still active, then waits on the task read.
    let openGate: () => void = () => {};
    const gate = new Promise<void>((r) => (openGate = r));
    const readSnapshot = deps.readTaskSnapshot;
    deps.readTaskSnapshot = async (id) => {
      await gate;
      return readSnapshot(id);
    };
    const viewing = loadConfirmLinkView({ token, now: NOW + 2 }, deps);
    await new Promise((r) => setTimeout(r, 10));

    // Meanwhile an answer is reserved, audited and applied (the task moves on).
    await store.reserve(link.linkId, NOW + 1);
    await deps.appendAudit({
      id: 'in-flight',
      at: new Date(NOW + 1).toISOString(),
      linkId: link.linkId,
      taskId: 1,
      pauseTransitionId: 10,
      questionId: 'Q1',
      selectedKey: 'A',
      respondentName: '外部 太郎',
      route: `external_confirm_link:${link.linkId}`,
      questionDigest: link.questionDigest,
    });
    snapshot = { workflowStatus: 'in_progress', latestPauseId: 10 };
    openGate();
    expect((await viewing).status).toBe(410);
    deps.readTaskSnapshot = readSnapshot;

    expect((await store.get(link.linkId))?.state).toBe('answering');
    snapshot = { workflowStatus: 'awaiting_question', latestPauseId: 11 };
    await issue();
    expect((await audits()).map((e) => e.id)).toEqual(['in-flight']);
  });

  test('R2: a lost compensation plus a failed prune still ends with one audit line after a retry', async () => {
    const token = await issue();
    applyAnswer.mockRejectedValueOnce(new Error('db down'));
    deps.removeAudit = async () => {
      throw new Error('disk error');
    };
    expect((await submit(token)).status).toBe(500);
    expect(await linkState()).toBe('active');

    deps.pruneOrphanAudits = async () => {
      throw new Error('prune failed');
    };
    const retried = await submit(token);

    expect(retried.status).toBe(200);
    expect(applyAnswer).toHaveBeenCalledTimes(2);
    expect(await audits()).toHaveLength(1);
  });

  test.each(['EIO', 'EACCES'])(
    'R4: 監査読取の%sで既存監査を保持して回答を拒否し、復旧後は一度だけ受け付ける',
    async (code) => {
      // 未作成の監査ファイルでは初回回答を受け付ける。
      expect(await audits()).toEqual([]);
      expect((await submit(await issue())).status).toBe(200);
      const accepted = await audits();
      expect(accepted).toHaveLength(1);

      snapshot = { workflowStatus: 'awaiting_question', latestPauseId: 11 };
      const token = await issue();
      const link = (await store.list(1)).find((record) => record.state === 'active')!;
      const before = readFileSync(join(dir, 'audit.ndjson'), 'utf8');
      applyAnswer.mockClear();

      const appendAudit = deps.appendAudit;
      deps.appendAudit = async (entry) => {
        // 先行する孤児掃除ではなく、実際の追記の読取だけに一時障害を注入する。
        const read = spyOn(fsPromises, 'readFile').mockRejectedValueOnce(
          Object.assign(new Error('監査読取の一時障害'), { code }),
        );
        try {
          await appendAudit(entry);
        } finally {
          read.mockRestore();
        }
      };
      const refused = await submit(token);
      expect(readFileSync(join(dir, 'audit.ndjson'), 'utf8')).toBe(before);
      expect(refused).toEqual({ status: 503, kind: 'unavailable' });
      expect(applyAnswer).not.toHaveBeenCalled();
      expect((await store.get(link.linkId))?.state).toBe('active');
      expect(await audits()).toEqual(accepted);

      deps.appendAudit = appendAudit;
      expect((await submit(token)).status).toBe(200);
      expect(applyAnswer).toHaveBeenCalledTimes(1);
      expect((await store.get(link.linkId))?.state).toBe('answered');
      const recovered = await audits();
      expect(recovered).toHaveLength(2);
      expect(recovered[0]).toEqual(accepted[0]);
      expect(recovered[1]).toMatchObject({
        linkId: link.linkId,
        respondentName: '外部 太郎',
        at: new Date(NOW + 1000).toISOString(),
        route: `external_confirm_link:${link.linkId}`,
      });
      expect((await submit(token)).status).toBe(410);
      expect(applyAnswer).toHaveBeenCalledTimes(1);
      expect(await audits()).toEqual(recovered);
    },
  );
});
