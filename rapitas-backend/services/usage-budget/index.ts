/**
 * usage-budget — barrel
 *
 * Re-exports the usage budget API and wires the default service instance to
 * the live store, execution sample loader and notifier.
 */
import {
  loadThemeNames,
  loadUsageSamples,
} from '../../routes/agents/agent-metrics/queries/theme-usage';
import { createUsageBudgetStore } from './usage-budget-store';
import { createUsageBudgetService } from './usage-budget-service';
import { notifyUsageBudgetThreshold } from './usage-budget-notify';

export * from './usage-budget-types';
export * from './usage-budget-math';
export {
  createUsageBudgetStore,
  type UsageBudgetStore,
  type UsageBudgetDb,
} from './usage-budget-store';
export {
  createUsageBudgetService,
  UsageBudgetValidationError,
  type UsageBudgetService,
  type UsageBudgetDeps,
  type EvaluateResult,
} from './usage-budget-service';
export { buildThresholdMessage, notifyUsageBudgetThreshold } from './usage-budget-notify';

/** Process-wide service bound to the live database. */
export const usageBudgetService = createUsageBudgetService({
  store: createUsageBudgetStore(),
  loadSamples: loadUsageSamples,
  loadThemeNames,
  notify: notifyUsageBudgetThreshold,
  now: () => new Date(),
});
