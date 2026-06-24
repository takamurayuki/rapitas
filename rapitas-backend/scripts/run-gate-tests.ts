#!/usr/bin/env bun
/**
 * run-gate-tests.ts
 *
 * Adapter script kept for backward compatibility.
 * Delegates to the universal gate runner (run-gate.ts) with the 'backend-tests' gate id.
 * Use `bun scripts/run-gate.ts backend-tests` or `bun run test:ci` for new code.
 *
 * @deprecated Use `bun scripts/run-gate.ts <gateId>` directly.
 */

/**
 * Re-export parseGateManifest from the canonical source module.
 * Existing imports of this symbol from run-gate-tests.ts continue to work.
 *
 * @deprecated Import from './gate-manifest-parser' directly in new code.
 */
export { parseGateManifest } from './gate-manifest-parser';

import { runGate } from './run-gate';

// NOTE: Guard prevents delegation from running when this file is imported by unit tests.
if (import.meta.main) {
  const code = await runGate('backend-tests');
  process.exit(code);
}
