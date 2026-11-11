/**
 * routing-acceptance-executor.test-helpers
 *
 * Test-only: the executor side of acceptance test H — a vendor failing the
 * implementer mid-task, handed to the real provider fallback. Not responsible
 * for the post-save review (routing-acceptance-flow.test-helpers.ts).
 */
import type { PrismaClient } from '../../../generated/prisma-sqlite';
import { agentConfig } from './routing-acceptance-flow.test-helpers';

/**
 * Fail the implementer's run with a vendor error and hand it to the real
 * provider fallback (tryProviderFallback → rerouteWithConstraints → role
 * routing over the discovered models). A replacement run, when one is
 * started, is recorded like a real one: an implementer AgentExecution with
 * the model it ran.
 *
 * @param db - SQLite client / DB
 * @param p.taskId - Task id / タスクID
 * @param p.failedModel - Model of the failed run / 失敗した実行のモデル
 * @param p.agentType - Agent of the failed run / 失敗した実行のエージェント
 * @param p.error - The vendor's failure text / ベンダーの失敗文
 * @returns The fallback result (null = refused) and the models it ran / 切替の結果
 */
export async function failExecutorAndFallback(
  db: PrismaClient,
  p: { taskId: number; failedModel: string; agentType: 'claude-code' | 'codex'; error: string },
): Promise<{ result: unknown; ranModels: Array<string | null> }> {
  await agentConfig(db, 'claude-code');
  await agentConfig(db, 'codex');
  const current = await agentConfig(db, p.agentType);
  const session = await db.agentSession.findFirstOrThrow({
    where: { config: { taskId: p.taskId }, mode: 'workflow-implementer' },
  });
  // The failed run itself: the CLI died before reporting a model.
  await db.agentExecution.create({
    data: {
      sessionId: session.id,
      agentConfigId: current.id,
      command: 'execute',
      status: 'failed',
      modelName: null,
      errorMessage: p.error,
    },
  });
  const ranModels: Array<string | null> = [];
  const { tryProviderFallback } = await import('../workflow-provider-fallback');
  const result = await tryProviderFallback({
    taskId: p.taskId,
    role: 'implementer',
    currentConfig: {
      id: current.id,
      agentType: current.agentType,
      name: current.name,
      modelId: p.failedModel,
    },
    firstResult: { success: false, error: p.error } as never,
    runAgent: (async (cfg: { id: number; modelId: string | null }) => {
      ranModels.push(cfg.modelId);
      await db.agentExecution.create({
        data: {
          sessionId: session.id,
          agentConfigId: cfg.id,
          command: 'execute',
          status: 'completed',
          modelName: cfg.modelId,
        },
      });
      return { success: true, output: 'done' };
    }) as never,
  });
  return { result, ranModels };
}
