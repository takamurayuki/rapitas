/**
 * log-health-suppressions.theme-auto-run-routes.test
 *
 * Verifies the suppression rule for the `routes:theme-auto-run`
 * `themeAutoRun.findUnique` data-type error (task 1285).
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const MSG =
  'Invalid `prisma.themeAutoRun.findUnique()` invocation in <path> # * @returns ThemeAutoRun state / ThemeAutoRun状態 # */ # export async function getOrCreateAutoRun(themeId: number): Promise<ThemeAutoRunState> { # const existing = await prisma.themeAutoRun.findUnique( Inconsistent column data: Conversion failed: input contains invalid characters';

describe('task 1285: themeAutoRun.findUnique Inconsistent column data', () => {
  test('is suppressed for routes:theme-auto-run with a stated reason', () => {
    const v = classifyLogSignature('routes:theme-auto-run', MSG);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or other tables', () => {
    expect(classifyLogSignature('other-logger', MSG).suppressed).toBe(false);
    expect(
      classifyLogSignature(
        'routes:theme-auto-run',
        MSG.replace('themeAutoRun.findUnique', 'task.findUnique'),
      ).suppressed,
    ).toBe(false);
  });
});
