/**
 * confirm-link-submit.test
 *
 * The answer path writes its audit line BEFORE applying the answer and
 * compensates only when the answer is known not to be applied. Failures are
 * injected at every step; the store and the audit file live in a real temp
 * directory (acceptance criteria 2, 3 and 4 of task 1430).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictError } from '../../../../middleware/error-handler';
import {
  appendConfirmLinkAudit,
  pruneTaskOrphanAudits,
  readConfirmLinkAudit,
  removeConfirmLinkAudit,
} from '../confirm-link-audit';
import { computeQuestionDigest } from '../confirm-link-question';
import { issueConfirmLink } from '../confirm-link-service';
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
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-submit-'));
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

describe('confirm-link submit (audit first)', () => {
  test('1: a valid answer applies once and leaves exactly one complete audit line', async () => {
    const token = await issue();
    const res = await submit(token);

    expect(res.status).toBe(200);
    expect(applyAnswer).toHaveBeenCalledTimes(1);
    const params = applyAnswer.mock.calls[0][0] as Record<string, unknown>;
    expect(params.expectedQuestionDigest).toBe(computeQuestionDigest(QUESTION_MD));
    expect(params.expectedPauseTransitionId).toBe(10);
    expect(params.selections).toEqual([{ questionId: 'Q1', selectedKey: 'A' }]);
    expect(params.actor).toBe('user');
    expect(params.sourceLabel).toBe('外部確認リンク');
    expect(params.answer).toBe('## Q1: 配色はどちらにしますか\n選択: 青（影響: 既定色を青にする）');
    expect(params.stopOverride).toBeUndefined();
    const lines = await audits();
    expect(lines).toHaveLength(1);
    expect(lines[0].respondentName).toBe('外部 太郎');
    expect(lines[0].at).toBe(new Date(NOW + 1000).toISOString());
    expect(lines[0].route).toBe(`external_confirm_link:${lines[0].linkId}`);
    expect(lines[0].questionDigest).toBe(computeQuestionDigest(QUESTION_MD));
    expect(await linkState()).toBe('answered');
  });

  test('2: a repeat after an accepted answer is 410 and changes nothing', async () => {
    const token = await issue();
    await submit(token);
    const res = await submit(token);

    expect(res.status).toBe(410);
    expect(applyAnswer).toHaveBeenCalledTimes(1);
    expect(await audits()).toHaveLength(1);
  });

  test('3: a question already answered internally is 410 with no apply and no audit', async () => {
    const token = await issue();
    snapshot = { workflowStatus: 'in_progress', latestPauseId: 10 };
    const res = await submit(token);

    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });

  test('4: a failing audit write refuses the answer (503) and the link can be retried', async () => {
    const token = await issue();
    const realAppend = deps.appendAudit;
    deps.appendAudit = async () => {
      throw new Error('disk full');
    };
    const refused = await submit(token);

    expect(refused.status).toBe(503);
    expect(applyAnswer).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
    expect(await linkState()).toBe('active');

    deps.appendAudit = realAppend;
    const retried = await submit(token);
    expect(retried.status).toBe(200);
    expect(await audits()).toHaveLength(1);
  });

  test('5: an apply conflict (409) removes the audit line and revokes the link', async () => {
    const token = await issue();
    applyAnswer.mockRejectedValue(new ConflictError('stale', 'question_outdated'));
    const res = await submit(token);

    expect(res.status).toBe(410);
    expect(await audits()).toHaveLength(0);
    expect(await linkState()).toBe('revoked');
  });

  test('6: a lost compensation is cleaned up by the next issue', async () => {
    const token = await issue();
    applyAnswer.mockRejectedValue(new ConflictError('stale', 'question_already_answered'));
    deps.removeAudit = async () => {
      throw new Error('disk error');
    };
    const res = await submit(token);

    expect(res.status).toBe(410);
    expect(await audits()).toHaveLength(1);
    await issue();
    expect(await audits()).toHaveLength(0);
  });

  test('7: an unexpected apply error while the question still waits releases the link, no audit', async () => {
    const token = await issue();
    applyAnswer.mockRejectedValue(new Error('db down'));
    const res = await submit(token);

    expect(res.status).toBe(500);
    expect(await audits()).toHaveLength(0);
    expect(await linkState()).toBe('active');
  });

  test('8: an unexpected apply error after the question moved on keeps the audit and consumes the link', async () => {
    const token = await issue();
    applyAnswer.mockImplementation(async () => {
      snapshot = { workflowStatus: 'in_progress', latestPauseId: 10 };
      throw new Error('connection reset after commit');
    });
    const res = await submit(token);

    expect(res.status).toBe(500);
    expect(await audits()).toHaveLength(1);
    expect(await linkState()).toBe('answering');
    expect((await submit(token)).status).toBe(410);
  });

  test('9: a read failure after reserve releases the link without applying or auditing', async () => {
    const token = await issue();
    // issue() already read question.md; from here on every read fails.
    deps.readQuestion = async () => {
      throw new Error('temporary read failure');
    };
    const res = await submit(token);

    expect(res.status).toBe(500);
    expect(applyAnswer).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
    expect(await linkState()).toBe('active');
  });
  test('an expired link is refused (410) without applying or auditing', async () => {
    const token = await issue();
    const res = await submitConfirmLinkAnswer(
      { token, choice: 'A', respondentName: '外部', confirmed: true, now: NOW + 86_400_000 },
      deps,
    );
    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
    expect(await audits()).toHaveLength(0);
  });

  test('a bad signature is refused (404) before the store is read', async () => {
    const token = await issue();
    const get = mock(store.get);
    deps.store = { ...store, get };
    const forged = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');

    expect((await submit(forged)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
    expect(applyAnswer).not.toHaveBeenCalled();
  });

  test('a missing name or unchecked confirmation is a 400 form error, not a consumed link', async () => {
    const token = await issue();
    const res = await submitConfirmLinkAnswer(
      { token, choice: 'A', respondentName: '  ', confirmed: false, now: NOW + 1 },
      deps,
    );
    expect(res.status).toBe(400);
    expect(await linkState()).toBe('active');
    expect(await audits()).toHaveLength(0);
  });
});
