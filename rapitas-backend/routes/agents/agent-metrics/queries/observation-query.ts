/**
 * Self-Observation Query — backward-compatibility shim
 *
 * The implementation moved to `observation/observation-query.ts` as part of the
 * queries/ subdirectory reorganization. This file is kept so pre-existing
 * direct importers of the old flat path keep resolving without edits.
 */

export * from './observation/observation-query';
