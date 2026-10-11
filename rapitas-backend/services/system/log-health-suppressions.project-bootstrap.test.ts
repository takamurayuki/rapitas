/**
 * log-health-suppressions.project-bootstrap.test
 *
 * Pins the suppression of the projectBootstrap "build scripts were skipped"
 * WARN (task #1209) while keeping the same logger's other WARNs visible.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

const LOGGER = 'git-operations/project-dependency-bootstrap';
const MSG =
  '[projectBootstrap] Dependencies installed but their build scripts were skipped; declare onlyBuiltDependencies in the project manifest if a native build is required';

describe('projectBootstrap ignored-build-scripts WARN', () => {
  test('is suppressed after normalization for the bootstrap logger', () => {
    const v = classifyLogSignature(LOGGER, normalizeMessage(MSG));
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('is scoped to the bootstrap logger only', () => {
    expect(classifyLogSignature('some-other-logger', normalizeMessage(MSG)).suppressed).toBe(false);
  });

  test('other WARNs of the same logger stay visible', () => {
    for (const other of [
      '[projectBootstrap] Could not record the install fingerprint',
      '[projectBootstrap] Project root has no manifest yet',
      '[projectBootstrap] Dependency install failed',
    ]) {
      expect(classifyLogSignature(LOGGER, normalizeMessage(other)).suppressed).toBe(false);
    }
  });
});
