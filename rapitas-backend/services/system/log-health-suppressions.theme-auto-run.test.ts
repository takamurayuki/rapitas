/**
 * log-health-suppressions.theme-auto-run.test
 *
 * Verifies the suppression rule for the theme-auto-run-scheduler
 * `themeAutoRun.findMany` data-type error (task 1284).
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const MSG =
  'Invalid `prisma.themeAutoRun.findMany()` invocation in <path> # * @returns matching records # export async function findByStatuses(statuses: AutoRunStatus[]): Promise<ThemeAutoRunState[]> { # const records = await prisma.themeAutoRun.findMany( Inconsistent column data: Conversion failed: input contains invalid characters';

describe('task 1284: themeAutoRun.findMany Inconsistent column data', () => {
  test('is suppressed for theme-auto-run-scheduler with a stated reason', () => {
    const v = classifyLogSignature('theme-auto-run-scheduler', MSG);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or other tables', () => {
    expect(classifyLogSignature('other-logger', MSG).suppressed).toBe(false);
    expect(
      classifyLogSignature(
        'theme-auto-run-scheduler',
        MSG.replace('themeAutoRun.findMany', 'task.findMany'),
      ).suppressed,
    ).toBe(false);
  });
});
