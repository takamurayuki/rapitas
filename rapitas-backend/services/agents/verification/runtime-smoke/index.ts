/**
 * runtime-smoke/index
 *
 * Barrel for the runtime smoke verification stage (launch the app-under-test
 * on a free port, drive it in a browser, fail the gate on hard errors).
 */
export { runRuntimeSmokeCheck, evaluateSmokeFindings } from './runtime-check';
export {
  loadRuntimeConfig,
  parseRuntimeConfig,
  substitutePort,
  RUNTIME_CONFIG_FILENAME,
  type RuntimeConfig,
} from './runtime-config';
export { allocateFreePort, launchApp, waitForHealthy } from './app-launcher';
export { runBrowserSmoke, type SmokeRunResult, type PathFinding } from './browser-smoke';
