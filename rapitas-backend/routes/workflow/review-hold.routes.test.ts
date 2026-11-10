/**
 * review-hold.routes テスト
 *
 * Resolving a review hold is a human decision: the POST requires the
 * X-Rapitas-Source header (as release-halt does) and a known action.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
const readReviewHold = mock(
  async (_id: number): Promise<Record<string, unknown> | null> => ({
    reason: 'unresolved_dispute',
    detail: 'd',
    findings: [],
  }),
);
mock.module('../../services/workflow/review-hold', () => ({ readReviewHold }));
const resolveReviewHold = mock(
  async (_p: Record<string, unknown>): Promise<Record<string, unknown>> => ({
    ok: true,
    action: 'override',
    outcome: 'publishing',
  }),
);
mock.module('../../services/workflow/review-hold-resolve', () => ({ resolveReviewHold }));

const { default: routes } = await import('./review-hold.routes');

const post = (body: unknown, headers: Record<string, string> = { 'x-rapitas-source': 'ui' }) =>
  routes.handle(
    new Request('http://localhost/workflow/tasks/5/review-hold/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  resolveReviewHold.mockClear();
  resolveReviewHold.mockResolvedValue({ ok: true, action: 'override', outcome: 'publishing' });
});

describe('review-hold routes', () => {
  test('GET は現在の保留を返す', async () => {
    const res = await routes.handle(new Request('http://localhost/workflow/tasks/5/review-hold'));
    expect(await res.json()).toMatchObject({
      success: true,
      held: true,
      hold: { reason: 'unresolved_dispute' },
    });
  });

  test('X-Rapitas-Source が無ければ 403（エージェントが自分で通せない）', async () => {
    const res = await post({ action: 'override' }, {});
    expect(res.status).toBe(403);
    expect(resolveReviewHold).not.toHaveBeenCalled();
  });

  test.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'agent'])(
    'X-Rapitas-Source: %s（許可リスト外・継承プロパティ）は 403',
    async (source) => {
      const res = await post({ action: 'override' }, { 'x-rapitas-source': source });
      expect(res.status).toBe(403);
      expect(resolveReviewHold).not.toHaveBeenCalled();
    },
  );

  test('X-Rapitas-Source は ui と operator（大文字小文字を問わない）を受理する', async () => {
    expect((await post({ action: 'accept' }, { 'x-rapitas-source': 'UI' })).status).toBe(200);
    expect((await post({ action: 'accept' }, { 'x-rapitas-source': 'operator' })).status).toBe(200);
  });

  test('未知の action は 400', async () => {
    const res = await post({ action: 'ship-it' });
    expect(res.status).toBe(400);
    expect(resolveReviewHold).not.toHaveBeenCalled();
  });

  test('accept / override を解消サービスへ渡し、操作者を記録する', async () => {
    const res = await post({ action: 'accept', note: ' 指摘どおり ' });
    expect(res.status).toBe(200);
    expect(resolveReviewHold).toHaveBeenCalledWith({
      taskId: 5,
      action: 'accept',
      resolvedBy: 'ユーザー操作',
      note: '指摘どおり',
    });
  });

  test('保留していない・二重操作は 409', async () => {
    resolveReviewHold.mockResolvedValue({ ok: false, reason: 'not_held' });
    const res = await post({ action: 'override' });
    expect(res.status).toBe(409);
  });
});
