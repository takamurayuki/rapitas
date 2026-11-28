/**
 * failure-hints — what the implementer gets back for each failing check (task 1602)
 */
import { describe, expect, test } from 'bun:test';
import type { VerificationCheck } from '../verification-check-types';
import { attachFailureHints } from './failure-hints';

const changed = [
  'rapitas-backend/services/a.ts',
  'rapitas-backend/services/b.ts',
  'rapitas-frontend/src/c.tsx',
];

const failing = (over: Partial<VerificationCheck>): VerificationCheck => ({
  name: 'lint',
  ran: true,
  ok: false,
  errorCount: 1,
  details: '',
  ...over,
});

describe('attachFailureHints', () => {
  test('lint output naming one file points at that file only', () => {
    const [lint] = attachFailureHints(
      [
        failing({
          details: 'C:\\work\\rapitas-backend\\services\\b.ts\n  3:1 error no-unused-vars',
        }),
      ],
      changed,
      'C:\\work',
    );
    expect(lint!.failureFiles).toEqual(['rapitas-backend/services/b.ts']);
    expect(lint!.gateMessage).toContain('Lint Code');
    expect(lint!.fixHint).toContain('eslint');
  });

  test('typecheck lists project-relative paths and they map back to the repo', () => {
    const [type] = attachFailureHints(
      [failing({ name: 'typecheck', details: 'tsc errors in changed files:\nsrc/c.tsx' })],
      changed,
    );
    expect(type!.failureFiles).toEqual(['rapitas-frontend/src/c.tsx']);
  });

  test('output with no path falls back to every changed file', () => {
    const [test] = attachFailureHints([failing({ name: 'test', details: 'timed out' })], changed);
    expect(test!.failureFiles).toEqual(changed);
  });

  test('scope uses its structured offending files', () => {
    const [scope] = attachFailureHints(
      [failing({ name: 'scope', details: 'x', offendingFiles: ['rapitas-backend/services/a.ts'] })],
      changed,
    );
    expect(scope!.failureFiles).toEqual(['rapitas-backend/services/a.ts']);
  });

  test('a runner that already named its files keeps them', () => {
    const [ig] = attachFailureHints(
      [failing({ name: 'import-graph', failureFiles: ['rapitas-backend/services/a.ts'] })],
      changed,
    );
    expect(ig!.failureFiles).toEqual(['rapitas-backend/services/a.ts']);
  });

  test('a passing check gets the gate message but no failure files', () => {
    const [ok] = attachFailureHints([{ ...failing({}), ok: true, errorCount: 0 }], changed);
    expect(ok!.failureFiles).toBeUndefined();
    expect(ok!.gateMessage).toBeTruthy();
  });

  test('an empty diff with a failure leaves an empty file list, not undefined', () => {
    const [lint] = attachFailureHints([failing({ details: 'boom' })], []);
    expect(lint!.failureFiles).toEqual([]);
  });
});
