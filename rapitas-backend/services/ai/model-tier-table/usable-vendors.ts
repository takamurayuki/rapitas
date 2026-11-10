/**
 * model-tier-table/usable-vendors
 *
 * Narrows a route's vendors to the ones usable right now (追補5: 利用状況):
 * a vendor whose provider is in cooldown after a quota, rate-limit or
 * authentication failure is temporarily unusable. Not responsible for knowing
 * which vendors are configured — the caller's route says that.
 *
 * NOTE: Deliberately does not run model discovery. Discovery spawns CLI
 * probes; the review path runs synchronously inside a file-save request and
 * must not pay for that. SmartRouter already merges the same cooldowns into
 * its own (discovery-based) candidate pool.
 */
import { listActiveCooldowns } from '../provider-cooldown';
import { vendorOfProvider, type ModelVendor } from './tier-table';

/** Usable vendors plus why the others are not. */
export interface VendorAvailability {
  usable: ModelVendor[];
  /** Route vendors temporarily unusable, with the cooldown reason (quota / auth …). */
  unavailable: Array<{ vendor: ModelVendor; reason: string }>;
}

/**
 * Split a route's vendors into usable and temporarily unusable.
 *
 * @param routeVendors - Vendors the route can reach when healthy / 経路で届くベンダー
 * @returns Usable vendors, route order kept / 使えるベンダー
 */
export function usableVendorsAmong(routeVendors: readonly ModelVendor[]): VendorAvailability {
  const cooled = new Map<ModelVendor, string>();
  for (const c of listActiveCooldowns()) {
    const vendor = vendorOfProvider(c.provider);
    if (vendor) cooled.set(vendor, c.reason);
  }
  const route = [...new Set(routeVendors)];
  return {
    usable: route.filter((v) => !cooled.has(v)),
    unavailable: route
      .filter((v) => cooled.has(v))
      .map((vendor) => ({ vendor, reason: cooled.get(vendor)! })),
  };
}
