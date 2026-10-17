/**
 * log-health-suppressions.research-sections.test
 *
 * Verifies the suppression rule for the fail-soft research.md missing-sections
 * WARN (task 1302). Split from the main suppression test file, which is already
 * over the size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const LOGGER = 'workflow-cli-executor';
const MESSAGE = '[WorkflowCLIExecutor] research.md missing sections: 影響範囲';

describe('task 1302: research.md missing 影響範囲 section (fail-soft)', () => {
  test('is suppressed for workflow-cli-executor with a stated reason', () => {
    const v = classifyLogSignature(LOGGER, MESSAGE);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other artifacts, sections, or loggers', () => {
    const kept = [
      '[WorkflowCLIExecutor] plan.md missing sections: 影響範囲',
      '[WorkflowCLIExecutor] verify.md missing sections: 影響範囲',
      '[WorkflowCLIExecutor] research.md missing sections: 影響範囲, リスク',
      '[WorkflowCLIExecutor] research.md missing sections: リスク評価',
    ];
    for (const msg of kept) {
      expect(classifyLogSignature(LOGGER, msg).suppressed).toBe(false);
    }
    expect(classifyLogSignature('some-other-logger', MESSAGE).suppressed).toBe(false);
  });
});
