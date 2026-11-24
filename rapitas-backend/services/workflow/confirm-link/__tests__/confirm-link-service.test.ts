/**
 * confirm-link-service.test
 *
 * Issuing a confirm link and building its public view with injected
 * dependencies: eligibility, 24-hour expiry, the question.md version pinned
 * at issue, and signature-first rejection (acceptance criteria 1, 3 and 6).
 * The answer path is covered by confirm-link-submit.test.ts.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConfirmLinkStore, type ConfirmLinkStore } from '../confirm-link-store';
import { computeQuestionDigest } from '../confirm-link-question';
import {
  issueConfirmLink,
  loadConfirmLinkView,
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
let snapshot: { workflowStatus: string | null; latestPauseId: number | null };
let deps: ConfirmLinkServiceDeps;
const applyAnswer = mock(async () => ({ kind: 'execution_continuation' }));
let question: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-svc-'));
  store = createConfirmLinkStore({ dir });
  question = QUESTION_MD;
  snapshot = { workflowStatus: 'awaiting_question', latestPauseId: 10 };
  applyAnswer.mockReset().mockResolvedValue({ kind: 'execution_continuation' });
  deps = {
    store,
    secret: SECRET,
    publicOrigin: 'https://confirm.example.com',
    readTaskSnapshot: async () => snapshot,
    readQuestion: async () => question,
    readResources: async () => [],
    applyAnswer,
    releaseHalt: async () => false,
    triggerReExecution: async () => {},
    appendAudit: async () => {},
    removeAudit: async () => {},
    pruneOrphanAudits: async () => {},
    readResourceOwner: async () => null,
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function issue(): Promise<string> {
  const res = await issueConfirmLink({ taskId: 1, message: 'ご確認ください', now: NOW }, deps);
  return res.url.split('/public/confirm-links/')[1];
}

describe('confirm-link service', () => {
  test('issue returns an absolute URL that expires 24 hours later', async () => {
    const res = await issueConfirmLink({ taskId: 1, message: 'm', now: NOW }, deps);
    expect(res.url.startsWith('https://confirm.example.com/public/confirm-links/v1.')).toBe(true);
    expect(res.expiresAt).toBe(NOW + 86_400_000);
  });

  test('issue pins the question.md version on the link', async () => {
    await issue();
    expect((await store.list(1))[0].questionDigest).toBe(computeQuestionDigest(QUESTION_MD));
  });

  test('issue is refused (422) for a question that is not a single two-way choice', async () => {
    question = QUESTION_MD.replace(
      '"key":"B","label":"緑"',
      '"key":"B","label":"緑"},{"key":"C","label":"赤"',
    );
    await expect(
      issueConfirmLink({ taskId: 1, message: '', now: NOW }, deps),
    ).rejects.toMatchObject({ status: 422, code: 'confirm_link_ineligible' });
  });

  test('issue is refused (409) when no secret is configured', async () => {
    deps.secret = null;
    await expect(
      issueConfirmLink({ taskId: 1, message: '', now: NOW }, deps),
    ).rejects.toMatchObject({ status: 409, code: 'confirm_link_disabled' });
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

  test('a re-saved question.md (same pause, same Q1) makes the old link 410 and revokes it', async () => {
    const token = await issue();
    question = QUESTION_MD.replace('配色はどちらにしますか', '書体はどちらにしますか');
    const res = await loadConfirmLinkView({ token, now: NOW + 1 }, deps);

    expect(res.status).toBe(410);
    const [link] = await store.list(1);
    expect(link.state).toBe('revoked');
    expect(link.revokedReason).toBe('question_resolved_internally');
  });

  test('an expired link is 410 for the view', async () => {
    const token = await issue();
    expect((await loadConfirmLinkView({ token, now: NOW + 86_400_000 }, deps)).status).toBe(410);
  });

  test('a bad signature is refused (404) before the store is read', async () => {
    const token = await issue();
    const get = mock(store.get);
    deps.store = { ...store, get };
    const forged = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');

    expect((await loadConfirmLinkView({ token: forged, now: NOW }, deps)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});
