/**
 * register-github-pr header guard tests
 *
 * The agent must not be able to link a PR to its own task: a request without
 * X-Rapitas-Source ui|operator is refused before any lookup happens.
 */
import { describe, test, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';

const recorded: unknown[] = [];
mock.module('../../../services/workflow/transition-recorder', () => ({
  recordTransition: async (input: unknown) => {
    recorded.push(input);
  },
}));

const { registerGithubPrRoutes } =
  await import('../../../routes/social/github/task-github-register-pr');

function post(headers: Record<string, string>) {
  const app = new Elysia().use(registerGithubPrRoutes);
  return app.handle(
    new Request('http://localhost/tasks/1269/register-github-pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ prNumber: 915, repo: 'acme/app' }),
    }),
  );
}

describe('POST /tasks/:id/register-github-pr guard', () => {
  test('ヘッダ無しは 403 で違反を記録すること', async () => {
    const res = await post({});
    expect(res.status).toBe(403);
    expect(recorded).toHaveLength(1);
  });

  test('ui/operator 以外の source は 403 になること', async () => {
    const res = await post({ 'X-Rapitas-Source': 'agent' });
    expect(res.status).toBe(403);
  });
});
