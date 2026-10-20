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
} from '../../services/scheduling/auto-restart-merged-code/deploy-now';
import { getAutoRestartMergedCodeScheduler } from '../../services/scheduling/auto-restart-merged-code';

/** The commit the running process started on. */
const startupCommit = () => getAutoRestartMergedCodeScheduler().getStartupCommit();

const deployRoutes = new Elysia({ prefix: '/deploy' })
  .get('/status', async () => await inspectDeploy(startupCommit()))

  .post('/now', async ({ set }) => {
    const result = await deployNow(startupCommit());
    // 409 for a refusal: the request was well-formed and the server is simply
    // not in a state to do it. A 200 with deployed:false would be read as
    // success by anything that only looks at the status.
    if (!result.deployed) set.status = 409;
    return result;
  });

export default deployRoutes;
