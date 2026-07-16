/**
 * burnup-chart/index.ts
 *
 * Barrel for the burnup chart widget (split per COMPONENT_SPLITTING_POLICY).
 */
export { default } from './burnup-chart';
export { BurnupSummary } from './burnup-summary';
export { useBurnupData } from './use-burnup-data';
export type { BurnupData, BurnupChartConfig } from './use-burnup-data';
