/**
 * UserSettings API Routes
 *
 * Barrel re-export that composes the settings routes and API-key routes
 * into the single `settingsRoutes` Elysia instance expected by the router.
 *
 * Not responsible for individual handler logic; see settings/ subdirectory.
 */

import { Elysia } from 'elysia';
import { settingsRoutes as coreSettingsRoutes } from './settings/settings-routes';
import { apiKeyRoutes } from './settings/api-key-routes';

export const settingsRoutes = new Elysia()
  .use(coreSettingsRoutes)
  .use(apiKeyRoutes);
