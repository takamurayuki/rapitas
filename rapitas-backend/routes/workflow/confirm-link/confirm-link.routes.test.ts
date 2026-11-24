/**
 * confirm-link.routes.test
 *
 * HTTP behaviour of the confirm-link routes with injected dependencies:
 * forged tokens get a bare 404, expired links 410, private resources 404,
 * HTML with no-store headers, and the human-only issue route
 * (acceptance criteria 1, 3, 5 and 6 of task 1430).
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createConfirmLinkStore } from '../../../services/workflow/confirm-link/confirm-link-store';
import type { ConfirmLinkServiceDeps } from '../../../services/workflow/confirm-link/confirm-link-types';
import { createConfirmLinkRoutes } from './confirm-link.routes';

const NOW = 1_800_000_000_000;
const QUESTION_MD =
  '```json:options\n' +
  JSON.stringify({
    questions: [
      {
        id: 'Q1',
        summary: '内部要約<script>alert(1)</script>',
        options: [
          { key: 'A', label: '案A' },
          { key: 'B', label: '案B' },
        ],
        freeTextRequired: false,
        recommended: 'A',
        recommendedReason: 'r',
      },
    ],
  }) +
  '\n```';

let dir: string;
let clock: number;
let deps: ConfirmLinkServiceDeps;
const applyAnswer = mock(async () => ({ kind: 'execution_continuation' }));

function app() {
  // Mirrors server-main.ts, which forces a JSON content type before every handler.
  return new Elysia()
    .onBeforeHandle(({ set }) => {
      set.headers['Content-Type'] = 'application/json; charset=utf-8';
    })
    .use(
      createConfirmLinkRoutes(
        () => deps,
        () => clock,
      ),
    );
}

async function issueToken(): Promise<string> {
  const res = await app().handle(
    new Request('http://localhost/workflow/tasks/1/confirm-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rapitas-source': 'ui' },
      body: JSON.stringify({ message: '確認をお願いします' }),
    }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { url: string };
  return body.url.split('/public/confirm-links/')[1];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'confirm-link-routes-'));
  clock = NOW;
  applyAnswer.mockReset().mockResolvedValue({ kind: 'execution_continuation' });
  deps = {
    store: createConfirmLinkStore({ dir }),
    secret: 'x'.repeat(40),
    publicOrigin: null,
    readTaskSnapshot: async () => ({ workflowStatus: 'awaiting_question', latestPauseId: 3 }),
    readQuestion: async () => QUESTION_MD,
    readResources: async () => [
      {
        id: 11,
        taskId: 1,
        title: '社内限定資料',
        type: 'file',
        url: null,
        filePath: 'a.pdf',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
      },
    ],
    applyAnswer,
    releaseHalt: async () => false,
    triggerReExecution: async () => {},
    appendAudit: async () => {},
    removeAudit: async () => {},
    pruneOrphanAudits: async () => {},
    readResourceOwner: async (id) => (id === 11 ? { id: 11, taskId: 1 } : null),
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('confirm-link routes', () => {
  test('issuing without X-Rapitas-Source is refused with 400', async () => {
    const res = await app().handle(
      new Request('http://localhost/workflow/tasks/1/confirm-links', { method: 'POST' }),
    );
    expect(res.status).toBe(400);
  });

  test('a valid link renders HTML with no-store and no-referrer headers', async () => {
    const token = await issueToken();
    const res = await app().handle(new Request(`http://localhost/public/confirm-links/${token}`));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')?.startsWith('text/html')).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).toContain('確認をお願いします');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  test('a forged token is a 404 whose body reveals nothing about the question', async () => {
    const token = await issueToken();
    const forged = token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A');
    const res = await app().handle(new Request(`http://localhost/public/confirm-links/${forged}`));

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain('内部要約');
    expect(html).not.toContain('案A');
  });

  test('posting to an expired link is a 410 and nothing is applied', async () => {
    const token = await issueToken();
    clock = NOW + 86_400_000;
    const res = await app().handle(
      new Request(`http://localhost/public/confirm-links/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'choice=A&respondentName=%E5%A4%96%E9%83%A8&confirmed=on',
      }),
    );
    expect(res.status).toBe(410);
    expect(applyAnswer).not.toHaveBeenCalled();
  });

  test('a form post on a valid link applies the answer and a repeat is 410', async () => {
    const token = await issueToken();
    const post = () =>
      app().handle(
        new Request(`http://localhost/public/confirm-links/${token}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'choice=B&respondentName=%E5%A4%96%E9%83%A8&confirmed=on',
        }),
      );
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(410);
    expect(applyAnswer).toHaveBeenCalledTimes(1);
  });

  test('a private resource id is 404 even with a valid token', async () => {
    const token = await issueToken();
    const res = await app().handle(
      new Request(`http://localhost/public/confirm-links/${token}/resources/11`),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('the issuer listing never returns tokens and reports resource flags', async () => {
    await issueToken();
    await app().handle(
      new Request('http://localhost/workflow/confirm-links/resources/11/visibility', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-rapitas-source': 'ui' },
        body: JSON.stringify({ externalPublic: true }),
      }),
    );
    const res = await app().handle(new Request('http://localhost/workflow/tasks/1/confirm-links'));
    const body = (await res.json()) as {
      links: Array<Record<string, unknown>>;
      resources: Array<{ id: number; externalPublic: boolean }>;
    };
    expect(body.links).toHaveLength(1);
    expect(JSON.stringify(body.links)).not.toContain('v1.');
    expect(body.resources).toEqual([{ id: 11, title: '社内限定資料', externalPublic: true }]);
  });
  test('a visibility PUT for a resource that does not exist is 404 and writes no tag', async () => {
    const setResourceTag = mock(deps.store.setResourceTag);
    deps.store = { ...deps.store, setResourceTag };
    const res = await app().handle(
      new Request('http://localhost/workflow/confirm-links/resources/999/visibility', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-rapitas-source': 'ui' },
        body: JSON.stringify({ externalPublic: true }),
      }),
    );
    expect(res.status).toBe(404);
    expect(setResourceTag).not.toHaveBeenCalled();
  });
});
