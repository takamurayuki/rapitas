/**
 * Deploy routes
 *
 * Asking the running process to activate code that is already merged.
 *
 * Thin layer — the decision and the git steps live in
 * `services/scheduling/auto-restart-merged-code/deploy-now`. This exists
 * because the automatic path is governed by timing gates measured in tens of
 * minutes, and there was no way for a person (or an agent, which cannot pull
 * the primary checkout itself) to say "now".
 *
 * GET reports; POST acts. They are separate because the POST restarts the
 * process, so it is not something to press in order to find out.
 */
import { Elysia } from 'elysia';
import {
  deployNow,
  inspectDeploy,
  type DeployNowResult,
  type DeployInspection,
} from '../../services/scheduling/auto-restart-merged-code/deploy-now';
import { getAutoRestartMergedCodeScheduler } from '../../services/scheduling/auto-restart-merged-code';

/**
 * Collaborators of the router.
 *
 * Injected rather than reached for, following `canary.routes.ts`: the tests
 * would otherwise have to `mock.module` the scheduler, and that replaces it
 * process-wide for every other test file in the run. Measured here — it took
 * `index.test.ts` from 45 passing to 58 failing, because its own
 * `AutoRestartMergedCodeScheduler` had been swapped for the stub.
 */
export interface DeployRouteDeps {
  startupCommit?: () => string | null;
  deploy?: (startupCommit: string | null) => Promise<DeployNowResult>;
  inspect?: (startupCommit: string | null) => Promise<DeployInspection>;
}

/**
 * Build the deploy router.
 *
 * @param deps - Stand-ins for the scheduler and the deploy service / 差し替え用の依存
 * @returns The router / ルーター
 */
export function createDeployRoutes(deps: DeployRouteDeps = {}) {
  const startupCommit =
    deps.startupCommit ?? (() => getAutoRestartMergedCodeScheduler().getStartupCommit());
  const runDeploy = deps.deploy ?? deployNow;
  const runInspect = deps.inspect ?? inspectDeploy;

  return new Elysia({ prefix: '/deploy' })
    .get('/status', async () => await runInspect(startupCommit()))

    .post('/now', async ({ set }) => {
      const result = await runDeploy(startupCommit());
      // 409 for a refusal: the request was well-formed and the server is
      // simply not in a state to do it. A 200 with deployed:false would be
      // read as success by anything that only looks at the status.
      if (!result.deployed) set.status = 409;
      return result;
    });
}

export const deployRoutes = createDeployRoutes();

export default deployRoutes;
