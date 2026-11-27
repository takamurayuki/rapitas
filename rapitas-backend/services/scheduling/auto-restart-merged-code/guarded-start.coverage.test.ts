/** 直接advanceの入口一覧と共通の登録境界を固定する。 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('列挙した全呼び出し元が共通orchestrator入口を利用する', async () => {
  const root = resolve(import.meta.dir, '../../..');
  const found: string[] = [];
  for await (const path of new Bun.Glob('{services,routes}/**/*.ts').scan(root)) {
    if (path.includes('.test.') || path.includes('__tests__')) continue;
    const source = readFileSync(resolve(root, path), 'utf8');
    if (/\badvanceWorkflow\s*\(/.test(source)) found.push(path.replaceAll('\\', '/'));
  }
  expect(found.sort()).toEqual(
    [
      'routes/agents/execution/post-handlers/dev-mode-planning-advance.ts',
      'routes/agents/execution/research/research-workflow-advance.ts',
      'routes/workflow/handlers/workflow-handlers-plan-revision.ts',
      'routes/workflow/handlers/workflow-handlers-plan.ts',
      'routes/workflow/handlers/workflow-handlers-resume-redispatch.ts',
      'services/scheduling/auto-restart-merged-code/deferred-advance.ts',
      'services/workflow/plan-auto-approve.ts',
      'services/workflow/workflow-api-executor.ts',
      'services/workflow/workflow-cli-executor-postprocess.ts',
      'services/workflow/workflow-orchestrator.ts',
      'services/workflow/workflow-redispatch.ts',
      'services/workflow/workflow-runner-item-helpers.ts',
    ].sort(),
  );
  const orchestrator = readFileSync(
    resolve(root, 'services/workflow/workflow-orchestrator.ts'),
    'utf8',
  );
  expect(orchestrator.indexOf('await admitAdvance(taskId)')).toBeLessThan(
    orchestrator.indexOf('await this.advanceAdmitted(taskId'),
  );
  for (const file of ['workflow-runner-dequeue-gate.ts', 'workflow-runner-halt-guard.ts']) {
    const source = readFileSync(resolve(root, 'services/workflow', file), 'utf8');
    expect(source).toContain('return guardedStart(');
  }
  // lifecycleロックを使うschedulerはorchestratorを直接呼ばない。
  for (const file of ['auto-run-advance-active.ts', 'auto-run-active-decision.ts']) {
    expect(readFileSync(resolve(root, 'services/workflow/auto-run', file), 'utf8')).not.toContain(
      'advanceWorkflow(',
    );
  }
});
