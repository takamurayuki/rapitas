/**
 * model-tier-table
 *
 * Public entry point for the model tier table (the single source of truth for
 * model tiers, prices and role suitability) and the seat planner that assigns
 * review seats from it.
 */
export {
  MODEL_TIER_TABLE,
  TIER_ORDER,
  UNREGISTERED_TIER_CEILING,
  capUnregisteredTier,
  costPer1kOf,
  findModelEntry,
  isSuitableForRole,
  roleColumnOf,
  seatableEntries,
  strongerTier,
  tierAtLeast,
  tierRank,
  vendorOfProvider,
  type AnyTier,
} from './tier-table';
export {
  executorRefOf,
  planSeats,
  type ExecutorRef,
  type PlannedSeat,
  type SeatIndependence,
  type SeatPlan,
  type SeatRequirement,
  type SeatShortfall,
} from './seat-planner';
export { usableVendorsAmong, type VendorAvailability } from './usable-vendors';
export { resolveExecutorModel } from './executor-model';
export type { ModelTierEntry, ModelVendor, RoleSuitability, TableTier } from './tier-table-types';
