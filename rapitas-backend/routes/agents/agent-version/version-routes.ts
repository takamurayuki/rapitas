/**
 * Agent Version Management Routes
 *
 * Composes read and write route groups into a single Elysia plugin.
 * Read routes live in version-read-routes.ts; write routes in version-write-routes.ts.
 */

import { Elysia } from 'elysia';
import { agentVersionReadRoutes } from './version-read-routes';
import { agentVersionWriteRoutes } from './version-write-routes';

export const agentVersionManagementRoutes = new Elysia()
  .use(agentVersionReadRoutes)
  .use(agentVersionWriteRoutes);
