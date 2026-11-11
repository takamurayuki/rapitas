/**
 * model-tier-table/usable-vendors
 *
 * Narrows the CONFIGURED vendors (configured-vendors.ts: API keys / Claude
 * CLI) to the ones usable right now (追補5: 利用状況): a vendor whose provider
 * is in cooldown after a quota, rate-limit or authentication failure is
 * temporarily unusable. Not responsible for reading the configuration.
 *
 * NOTE: Deliberately does not run model discovery. Discovery spawns CLI
 * probes; the review path runs synchronously inside a file-save request and
 * must not pay for that. SmartRouter already merges the same cooldowns into
 * its own (discovery-based) candidate pool.
 */
import { listActiveCooldowns } from '../provider-cooldown';
import { vendorOfProvider, type ModelVendor } from './tier-table';
import type { ConfiguredVendors } from './configured-vendors';

/** Usable vendors plus why the others are not. */
export interface VendorAvailability {
  usable: ModelVendor[];
  /**
   * Vendors not usable: not configured, or in cooldown (quota / auth …).
   * `resumeAt` (ISO) is when a cooldown is expected to lift — shown and
   * recorded so a stopped jury says when it can sit again (routing2b,
   * owner decision 3: 止まった理由と再開見込みを出す).
   */
  unavailable: Array<{ vendor: ModelVendor; reason: string; resumeAt?: string }>;
}

/**
 * Split the configured vendors into usable and temporarily unusable.
 *
 * @param configured - Vendors set up on this host, in route order / 設定済みのベンダー
 * @param unconfigured - Vendors not set up, with the reason / 未設定のベンダー
 * @returns Usable vendors, route order kept / 使えるベンダー
 */
export function usableVendorsAmong(
  configured: readonly ModelVendor[],
  unconfigured: ConfiguredVendors['unconfigured'] = [],
): VendorAvailability {
  const cooled = new Map<ModelVendor, { reason: string; until: number }>();
  for (const c of listActiveCooldowns()) {
    const vendor = vendorOfProvider(c.provider);
    if (vendor) cooled.set(vendor, { reason: c.reason, until: c.until });
  }
  const route = [...new Set(configured)];
  return {
    usable: route.filter((v) => !cooled.has(v)),
    unavailable: [
      ...unconfigured,
      ...route
        .filter((v) => cooled.has(v))
        .map((vendor) => {
          const c = cooled.get(vendor)!;
          return { vendor, reason: c.reason, resumeAt: new Date(c.until).toISOString() };
        }),
    ],
  };
}
