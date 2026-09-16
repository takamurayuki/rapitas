/**
 * supervision routes
 *
 * Auto-discovered mount point (scripts/generate-route-barrels.cjs picks up
 * `*.routes.ts`) for the /agents/supervision acceptance-gate endpoints.
 */
import { supervisionRouter } from './supervision-router';

export default supervisionRouter;
