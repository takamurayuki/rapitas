/**
 * Theme Usage Query — barrel
 *
 * Re-exports the daily × theme usage aggregation and its theme resolver.
 */

export type {
  UsageCell,
  ThemeUsageTotal,
  ThemeUsageDay,
  ThemeUsageResult,
} from './theme-usage-query';
export {
  getThemeUsage,
  loadUsageSamples,
  loadThemeNames,
  aggregateThemeDaily,
} from './theme-usage-query';
export { classifyByRules, resolveSessionThemes } from './theme-usage-resolver';
