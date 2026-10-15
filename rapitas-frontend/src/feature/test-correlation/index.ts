/**
 * test-correlation (barrel)
 *
 * Re-exports the test-failure correlation heatmap feature's public API.
 */
export {
  useTestCorrelationMatrix,
  fetchTestCorrelationDrilldown,
} from './hooks/useTestCorrelationMatrix';
export { TestCorrelationHeatmap } from './components/TestCorrelationHeatmap';
export { TestCorrelationDrilldown } from './components/TestCorrelationDrilldown';
export * from './test-correlation.types';
