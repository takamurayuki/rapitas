/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { habitsRoutes } from './habits';
import { paidLeaveRoutes } from './paid-leave';

export { habitsRoutes } from './habits';
export { paidLeaveRoutes } from './paid-leave';

export const lifestyleDomainRoutes = new Elysia().use(habitsRoutes).use(paidLeaveRoutes);
