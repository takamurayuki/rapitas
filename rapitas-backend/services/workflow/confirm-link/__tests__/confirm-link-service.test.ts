/**
 * confirm-link-service.test
 *
 * Issue / view / answer through a confirm link with injected dependencies:
 * answer reflection, one-shot, internal-answer precedence, exactly one audit
 * line, and signature-first rejection (acceptance criteria 1-4 and 6).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictError } from '../../../../middleware/error-handler';
import { createConfirmLinkStore, type ConfirmLinkStore } from '../confirm-link-store';
import type { ConfirmLinkAuditEntry } from '../confirm-link-audit';
import {
  issueConfirmLink,
  loadConfirmLinkView,
  submitConfirmLinkAnswer,
  type ConfirmLinkServiceDeps,
} from '../confirm-link-service';

const SECRET = 's'.repeat(40);
const NOW = 1_800_000_000_000;
const QUESTION_MD = [
  '# 質問',
  '```json:options',
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
  }),
  '```',
].join('\n');

let dir: string;
let store: ConfirmLinkStore;
let audits: ConfirmLinkAuditEntry[];
let snapshot: { workflowStatus: string | null; latestPauseId: number | null };
let deps: ConfirmLinkServiceDeps;
const applyAnswer = mock(async () => ({ kind: 'execution_continuation' }));
const releaseHalt = mock(async () => false);
const triggerReExecution = mock(async () => {});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-svc-'));
  store = createConfirmLinkStore({ dir });
  audits = [];
  snapshot = { workflowStatus: 'awaiting_question', latestPauseId: 10 };
  applyAnswer.mockReset().mockResolvedValue({ kind: 'execution_continuation' });
  releaseHalt.mockReset().mockResolvedValue(false);
  triggerReExecution.mockReset().mockResolvedValue(undefined);
  deps = {
    store,
    secret: SECRET,
    publicOrigin: 'https://confirm.example.com',
    readTaskSnapshot: async () => snapshot,
    readQuestion: async () => QUESTION_MD,
    readResources: async () => [],
    applyAnswer,
    releaseHalt,
    triggerReExecution,
    appendAudit: async (e) => {
      audits.push(e);
    },
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function issue(): Promise<string> {
  const res = await issueConfirmLink({ taskId: 1, message: 'ご確認ください', now: NOW }, deps);
  return res.url.split('/public/confirm-links/')[1];
}

function answer(token: string, choice = 'A', now = NOW + 1000) {
  return submitConfirmLinkAnswer(
    { token, choice, respondentName: '外部 太郎', confirmed: true, now },
    deps,
  );
}

describe('confirm-link service', () => {
  test('issue returns an absolute URL that expires 24 hours later', async () => {
    const res = await issueConfirmLink({ taskId: 1, message: 'm', now: NOW }, deps);
    expect(res.url.startsWith('https://confirm.example.com/public/confirm-links/v1.')).toBe(true);
    expect(res.expiresAt).toBe(NOW + 86_400_000);
  });

  test('issue is refused (422) for a question that is not a single two-way choice', async () => {
    deps.readQuestion = async () =>
      QUESTION_MD.replace(
        '"key":"B","label":"緑"',
        '"key":"B","label":"緑"},{"key":"C","label":"赤"',
      );
    await expect(
      issueConfirmLink({ taskId: 1, message: '', now: NOW }, deps),
    ).rejects.toMatchObject({
      status: 422,
      code: 'confirm_link_ineligible',
    });
  });

  test('issue is refused (409) when no secret is configured', async () => {
    deps.secret = null;
    await expect(
      issueConfirmLink({ taskId: 1, message: '', now: NOW }, deps),
    ).rejects.toMatchObject({
      status: 409,
      code: 'confirm_link_disabled',
    });
  });

  test('choosing A applies the answer once with the captured pause and no stop override', async () => {
    const token = await issue();
    const res = await answer(token);

    expect(res.status).toBe(200);
    expect(applyAnswer).toHaveBeenCalledTimes(1);
    const params = applyAnswer.mock.calls[0][0] as Record<string, unknown>;
    expect(params.selections).toEqual([{ questionId: 'Q1', selectedKey: 'A' }]);
    expect(params.expectedPauseTransitionId).toBe(10);
    expect(params.actor).toBe('user');
    expect(params.sourceLabel).toBe('外部確認リンク');
    expect(params.stopOverride).toBeUndefined();
    expect(params.answer).toBe('## Q1: 配色はどちらにしますか\n選択: 青（影響: 既定色を青にする）');
  });

  test('a second submission is refused (410) and does not apply again', async () => {
    const token = await issue();
    await answer(token);
    const second = await answer(token, 'B');

    expect(second.status).toBe(410);
    expect(applyAnswer).toHaveBeenCalledTimes(1);
    expect((await store.list(1))[0].state).toBe('answered');
  });

  test('an answer after the question was answered internally is refused (410) and revokes the link', async () => {
    const token = await issue();
    snapshot = { workflowStatus: 'in_progress', latestPauseId: 10 };
    const res = await answer(token);

    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
    expect((await store.list(1))[0].revokedReason).toBe('question_resolved_internally');
    expect(audits).toHaveLength(0);
  });

  test('an expired link is refused (410) without applying', async () => {
    const token = await issue();
    const res = await answer(token, 'A', NOW + 86_400_000);
    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
  });

  test('an accepted answer writes exactly one audit line with name and route', async () => {
    const token = await issue();
    await answer(token);

    expect(audits).toHaveLength(1);
    expect(audits[0].respondentName).toBe('外部 太郎');
    expect(audits[0].selectedKey).toBe('A');
    expect(audits[0].route).toBe(`external_confirm_link:${audits[0].linkId}`);
    expect(audits[0].at).toBe(new Date(NOW + 1000).toISOString());
  });

  test('a refused answer writes no audit line', async () => {
    const token = await issue();
    applyAnswer.mockRejectedValue(new ConflictError('stale', 'question_outdated'));
    const res = await answer(token);

    expect(res.status).toBe(410);
    expect(audits).toHaveLength(0);
    expect((await store.list(1))[0].state).toBe('revoked');
  });

  test('a bad signature is refused (404) before the store is read', async () => {
    const token = await issue();
    const get = mock(store.get);
    deps.store = { ...store, get };
    const forged = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');

    expect((await answer(forged)).status).toBe(404);
    expect((await loadConfirmLinkView({ token: forged, now: NOW }, deps)).status).toBe(404);
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
    expect((await store.list(1))[0].state).toBe('active');
  });

  test('the view shows the issuer message and options but not question.md prose', async () => {
    const token = await issue();
    const res = await loadConfirmLinkView({ token, now: NOW + 1 }, deps);
    expect(res.status).toBe(200);
    if (res.kind !== 'form') throw new Error('expected form');
    expect(res.view.message).toBe('ご確認ください');
    expect(res.view.options.map((o) => o.key)).toEqual(['A', 'B']);
    expect(JSON.stringify(res.view)).not.toContain('# 質問');
  });
  test('a failing audit append does not undo an accepted answer', async () => {
    const token = await issue();
    deps.appendAudit = async () => {
      throw new Error('disk full');
    };
    const res = await answer(token);
    expect(res.status).toBe(200);
    expect((await store.list(1))[0].state).toBe('answered');
  });

  test('a link left in answering (crash after apply) is treated as consumed', async () => {
    const token = await issue();
    const [link] = await store.list(1);
    await store.reserve(link.linkId, NOW);
    const res = await answer(token);
    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
  });
});
