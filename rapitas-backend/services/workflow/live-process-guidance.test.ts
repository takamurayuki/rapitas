/**
 * live-process-guidance.test
 *
 * 2026-11-22 (trendline task 1520): plans asked the verifier to run start.bat /
 * start.sh by hand. The verifier could not stop what it started, the stack kept
 * port 8090, and each following verification failed with "port in use". The
 * runtime check already starts the app, checks it and stops it under recorded
 * ownership; startup is to be confirmed through it.
 */
import { describe, expect, test } from 'bun:test';
import { liveProcessGuidance } from './live-process-guidance';

describe('liveProcessGuidance', () => {
  test.each(['planner', 'implementer', 'verifier'] as const)(
    'points %s at the runtime check and requires stopping what it starts',
    (role) => {
      for (const lang of ['ja', 'en']) {
        const text = liveProcessGuidance(role, lang);
        expect(text).toMatch(/run-verification/);
        expect(text).toMatch(/runtime/);
        expect(text).toMatch(/止める|stop/i);
      }
    },
  );

  test('the planner is told to plan the stop step, not to leave it to the verifier', () => {
    expect(liveProcessGuidance('planner', 'ja')).toMatch(/停止の手順/);
    expect(liveProcessGuidance('planner', 'en')).toMatch(/stop step/i);
  });
});
