/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import missSignaturesRoute from './miss-signatures.routes';
import repairRiskRoute from './repair-risk.routes';

export const selfImprovementDomainRoutes = new Elysia()
  .use(missSignaturesRoute)
  .use(repairRiskRoute);
