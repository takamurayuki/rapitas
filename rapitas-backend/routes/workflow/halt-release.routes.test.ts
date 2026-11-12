/**
 * halt-release.routes tests
 *
 * POST /workflow/tasks/:taskId/release-halt is a human decision (companion
 * design 2章; the mobile decision screen calls it with X-Rapitas-Source: ui).
 * Without the ui/operator header — including a caller that labels itself as
 * ラピ or an agent — it is refused and the halt is not touched.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
const releaseTaskHalt = mock(
  async (
    taskId: number,
    _hypothesis: string,
    _actor: string,
  ): Promise<Record<string, unknown>> => ({
    ok: true,
    taskId,
    previousHaltReason: 'budget_cost_exceeded',
    toStatus: 'in_progress',
  }),
);
mock.module('../../services/workflow/halt-release', () => ({
  releaseTaskHalt,
  MIN_HYPOTHESIS_CHARS: 10,
  HALT_RELEASED_CAUSE: 'halt_released',
}));
const recordTransition = mock(async (_p: Record<string, unknown>) => {});
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));

const { default: routes } = await import('./halt-release.routes');

const HYPOTHESIS = '依存の版を固定したので前回と違う結果になるはず';

const post = (body: unknown, headers: Record<string, string> = { 'x-rapitas-source': 'ui' }) =>
  routes.handle(
    new Request('http://localhost/workflow/tasks/5/release-halt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  releaseTaskHalt.mockClear();
  recordTransition.mockClear();
});

describe('POST /workflow/tasks/:taskId/release-halt', () => {
  test('releases with the ui header and a hypothesis, recording the user as the actor', async () => {
    const res = await post({ hypothesis: HYPOTHESIS });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      taskId: 5,
      previousHaltReason: 'budget_cost_exceeded',
    });
    expect(releaseTaskHalt).toHaveBeenCalledWith(5, HYPOTHESIS, 'ユーザー操作');
  });

  test('refuses without the header and records the blocked attempt', async () => {
    const res = await post({ hypothesis: HYPOTHESIS }, {});
    expect(res.status).toBe(403);
    expect(releaseTaskHalt).not.toHaveBeenCalled();
    expect(recordTransition.mock.calls[0]?.[0]).toMatchObject({
      cause: 'halt_release_blocked',
      invariantViolation: true,
    });
  });

  test.each(['assistant', 'rapi', 'agent', 'constructor'])(
    'refuses a %s-labelled caller — only ui/operator are human',
    async (source) => {
      const res = await post({ hypothesis: HYPOTHESIS }, { 'x-rapitas-source': source });
      expect(res.status).toBe(403);
      expect(releaseTaskHalt).not.toHaveBeenCalled();
    },
  );

  test('requires a hypothesis long enough to mean something', async () => {
    const res = await post({ hypothesis: '再試行' });
    expect(res.status).toBe(400);
    expect(releaseTaskHalt).not.toHaveBeenCalled();
  });

  test('a review hold is not released here (409)', async () => {
    releaseTaskHalt.mockResolvedValueOnce({ ok: false, reason: 'review_hold' });
    const res = await post({ hypothesis: HYPOTHESIS });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ success: false, error: 'review_hold' });
  });
});
