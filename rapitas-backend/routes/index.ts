/**
 * Routes barrel export
 *
 * Each domain owns its own barrel (routes/<domain>/index.ts) that both
 * re-exports its individual route symbols and exports a merged
 * `<domain>DomainRoutes` Elysia instance. This file only re-exports those
 * domain barrels — it never lists individual route modules itself, so a new
 * feature never needs to edit this file (see task #675).
 */

export * from './organization';
export * from './tasks';
export * from './agents';
export * from './ai';
export * from './scheduling';
export * from './learning';
export * from './system';
export * from './workflow';
export * from './social';
export * from './analytics';
export * from './lifestyle';
export * from './memory';
export * from './self-improvement';
export * from './self-learning';
