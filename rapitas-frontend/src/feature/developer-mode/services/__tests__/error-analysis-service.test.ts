/**
 * error-analysis-service tests
 *
 * errorAnalysisService is a module-level singleton (no exported class /
 * factory), so every test resets its internal state via
 * clearErrorHistory() in beforeEach to avoid cross-test pollution of
 * errorHistory / errorCounts.
 */
import { errorAnalysisService, ErrorCategory, ErrorSeverity } from '../error-analysis-service';
import type { Task, AgentSession } from '@/types';

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'todo',
    priority: 'medium',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAgentSession(id: number): AgentSession {
  return {
    id,
    configId: 1,
    status: 'running',
    lastActivityAt: new Date().toISOString(),
    totalTokensUsed: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  errorAnalysisService.clearErrorHistory();
});

describe('analyzeError — pattern categorization', () => {
  test.each([
    ['SyntaxError: Unexpected token }', ErrorCategory.SYNTAX, ErrorSeverity.HIGH],
    ['TypeError: Cannot read prop of undefined', ErrorCategory.RUNTIME, ErrorSeverity.HIGH],
    ['Failed to fetch resource', ErrorCategory.NETWORK, ErrorSeverity.HIGH],
    ['CORS policy blocked the request', ErrorCategory.NETWORK, ErrorSeverity.HIGH],
    ['P2002 unique constraint failed', ErrorCategory.DATABASE, ErrorSeverity.HIGH],
    ['Permission denied for this resource', ErrorCategory.PERMISSION, ErrorSeverity.HIGH],
    ['Request timed out after 30s', ErrorCategory.TIMEOUT, ErrorSeverity.MEDIUM],
    ['ValidationError: Required field missing', ErrorCategory.VALIDATION, ErrorSeverity.MEDIUM],
    ['Cannot find module "foo"', ErrorCategory.DEPENDENCY, ErrorSeverity.HIGH],
  ])('classifies "%s" as %s/%s', (message, category, severity) => {
    const analysis = errorAnalysisService.analyzeError(message);
    expect(analysis.category).toBe(category);
    expect(analysis.severity).toBe(severity);
    expect(analysis.suggestedFixes.length).toBeGreaterThan(0);
  });

  test('falls back to UNKNOWN/MEDIUM with no suggested fixes for an unrecognized message', () => {
    const analysis = errorAnalysisService.analyzeError('a completely novel problem occurred');
    expect(analysis.category).toBe(ErrorCategory.UNKNOWN);
    expect(analysis.severity).toBe(ErrorSeverity.MEDIUM);
    expect(analysis.suggestedFixes).toEqual([]);
    expect(analysis.documentationLinks).toEqual([]);
  });

  test('records the message, timestamp, and generates a unique id', () => {
    const a1 = errorAnalysisService.analyzeError('Timeout occurred');
    const a2 = errorAnalysisService.analyzeError('Timeout occurred');
    expect(a1.message).toBe('Timeout occurred');
    expect(a1.timestamp).toBeInstanceOf(Date);
    expect(a1.id).not.toBe(a2.id);
  });
});

describe('analyzeError — context and stack-trace suggestions', () => {
  test('attaches affected task and agent from context', () => {
    const task = makeTask(1);
    const agent = makeAgentSession(2);
    const analysis = errorAnalysisService.analyzeError('Permission denied', {
      task,
      agent,
      userAction: 'clicked run',
    });
    expect(analysis.affectedTasks).toEqual([task]);
    expect(analysis.affectedAgents).toEqual([agent]);
    expect(analysis.context.userAction).toBe('clicked run');
  });

  test('adds a node_modules suggestion when the stack trace references it', () => {
    const analysis = errorAnalysisService.analyzeError('TypeError: Cannot read prop of x', {
      stackTrace: 'at foo (/repo/node_modules/pkg/index.js:10:5)',
    });
    expect(analysis.suggestedFixes.some((f) => f.toLowerCase().includes('third-party'))).toBe(true);
  });

  test('adds an async/Promise suggestion when the stack trace mentions them', () => {
    const analysis = errorAnalysisService.analyzeError('Request timed out', {
      stackTrace: 'at async doWork (/repo/src/x.ts:1:1)',
    });
    expect(analysis.suggestedFixes.some((f) => f.includes('asynchronous'))).toBe(true);
  });

  test('extracts up to 3 file locations from the stack trace', () => {
    const stackTrace = [
      'Error: boom',
      'at a (/repo/src/a.ts:1:1)',
      'at b (/repo/src/b.ts:2:2)',
      'at c (/repo/src/c.ts:3:3)',
      'at d (/repo/src/d.ts:4:4)',
    ].join('\n');
    const analysis = errorAnalysisService.analyzeError('Cannot find module', { stackTrace });
    const fileSuggestion = analysis.suggestedFixes.find((f) =>
      f.startsWith('Check the following files'),
    );
    expect(fileSuggestion).toBeDefined();
    expect(fileSuggestion).toContain('a.ts:1:1');
    expect(fileSuggestion).toContain('b.ts:2:2');
    expect(fileSuggestion).toContain('c.ts:3:3');
    expect(fileSuggestion).not.toContain('d.ts:4:4');
  });
});

describe('analyzeError — related errors', () => {
  test('finds a prior error in the same category', () => {
    errorAnalysisService.analyzeError('Failed to fetch data');
    const second = errorAnalysisService.analyzeError('NetworkError while loading');
    expect(second.relatedErrors.length).toBeGreaterThanOrEqual(1);
    expect(second.relatedErrors[0].category).toBe(ErrorCategory.NETWORK);
  });

  test('finds a prior error whose message has high word overlap (similarity > 0.7)', () => {
    errorAnalysisService.analyzeError('the request to load user profile data failed badly');
    const second = errorAnalysisService.analyzeError(
      'the request to load user profile data failed again',
    );
    expect(second.relatedErrors.some((e) => e.message.includes('failed badly'))).toBe(true);
  });

  test('finds a prior error affecting the same task', () => {
    const task = makeTask(42);
    errorAnalysisService.analyzeError('some unrelated unknown error', { task });
    const second = errorAnalysisService.analyzeError('a totally different unknown error', { task });
    expect(second.relatedErrors.some((e) => e.affectedTasks.some((t) => t.id === 42))).toBe(true);
  });

  test('does not consider unrelated errors as related', () => {
    errorAnalysisService.analyzeError('Cannot find module "left-pad"');
    const second = errorAnalysisService.analyzeError('Permission denied for admin panel');
    expect(second.relatedErrors).toEqual([]);
  });

  test('caps related errors at 5', () => {
    for (let i = 0; i < 8; i++) {
      errorAnalysisService.analyzeError(`Permission denied case ${i}`);
    }
    const latest = errorAnalysisService.analyzeError('Permission denied final case');
    expect(latest.relatedErrors.length).toBe(5);
  });
});

describe('errorHistory cap', () => {
  test('keeps at most 1000 entries in history (reflected via getErrorSummary totals)', () => {
    for (let i = 0; i < 1005; i++) {
      errorAnalysisService.analyzeError(`bulk error ${i}`);
    }
    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.totalErrors).toBe(1000);
  });
});

describe('getErrorSummary', () => {
  test('aggregates counts by category and severity', () => {
    errorAnalysisService.analyzeError('SyntaxError: Unexpected token');
    errorAnalysisService.analyzeError('Permission denied');
    errorAnalysisService.analyzeError('Permission denied');

    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.totalErrors).toBe(3);
    expect(summary.errorsByCategory[ErrorCategory.PERMISSION]).toBe(2);
    expect(summary.errorsByCategory[ErrorCategory.SYNTAX]).toBe(1);
    expect(summary.errorsBySeverity[ErrorSeverity.HIGH]).toBe(3);
  });

  test('reports the most common errors sorted by frequency, capped at 5', () => {
    for (let i = 0; i < 4; i++) errorAnalysisService.analyzeError('Permission denied');
    for (let i = 0; i < 2; i++) errorAnalysisService.analyzeError('Cannot find module "x"');
    errorAnalysisService.analyzeError('Request timed out');

    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.mostCommonErrors[0]).toMatchObject({
      message: 'Permission denied',
      count: 4,
      category: ErrorCategory.PERMISSION,
    });
  });

  test('produces 24 hourly trend buckets', () => {
    errorAnalysisService.analyzeError('some error');
    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.errorTrends).toHaveLength(24);
    const total = summary.errorTrends.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  test('filters by an explicit time range', () => {
    errorAnalysisService.analyzeError('in range error');
    const future = { start: new Date(Date.now() + 60_000), end: new Date(Date.now() + 120_000) };
    const summary = errorAnalysisService.getErrorSummary(future);
    expect(summary.totalErrors).toBe(0);
  });

  test('empty history yields zeroed-out summary', () => {
    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.totalErrors).toBe(0);
    expect(summary.mostCommonErrors).toEqual([]);
    Object.values(ErrorCategory).forEach((cat) => {
      expect(summary.errorsByCategory[cat]).toBe(0);
    });
  });
});

describe('clearErrorHistory', () => {
  test('empties history and counts', () => {
    errorAnalysisService.analyzeError('Permission denied');
    errorAnalysisService.clearErrorHistory();
    const summary = errorAnalysisService.getErrorSummary();
    expect(summary.totalErrors).toBe(0);
    expect(summary.mostCommonErrors).toEqual([]);
  });
});

describe('exportErrorLog', () => {
  test('exports a JSON string containing the export date, summary, and error entries', () => {
    errorAnalysisService.analyzeError('Permission denied');
    const json = errorAnalysisService.exportErrorLog();
    const parsed = JSON.parse(json);
    expect(parsed.exportDate).toEqual(expect.any(String));
    expect(parsed.summary.totalErrors).toBe(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].message).toBe('Permission denied');
  });

  test('caps exported errors at 100', () => {
    for (let i = 0; i < 105; i++) errorAnalysisService.analyzeError(`error ${i}`);
    const parsed = JSON.parse(errorAnalysisService.exportErrorLog());
    expect(parsed.errors).toHaveLength(100);
  });
});
