/**
 * failure-lineage barrel
 *
 * Public API of the failure-lineage service.
 */
export * from './failure-lineage-types';
export { computeFailureLineage } from './failure-lineage-service';
export { buildNodes, buildEdges, buildClusters } from './lineage-builder';
export { scoreRootCauses } from './root-cause-scorer';
export { validateLineage } from './postmortem-validator';
