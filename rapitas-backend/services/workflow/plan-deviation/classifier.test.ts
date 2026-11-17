/**
 * classifier tests — the judging pseudo-code in plan.md, step by step.
 */
import { describe, expect, test } from 'bun:test';
import { classifyOperations } from './classifier';
import type { OperationRecord, ParsedDeclaration, PlanDeclaration } from './types';

function decl(partial: Partial<PlanDeclaration>): ParsedDeclaration {
  const declaration: PlanDeclaration = {
    version: 1,
    files: [],
    commands: [],
    externalHosts: [],
    ...partial,
  };
  return { declaration, source: 'fence', ambiguous: declaration.files.length === 0, warnings: [] };
}

let seq = 0;
function op(
  kind: OperationRecord['kind'],
  features: OperationRecord['features'],
  at?: string,
): OperationRecord {
  seq += 1;
  return {
    seq,
    occurredAt: at ?? `2026-10-13T00:00:${String(seq).padStart(2, '0')}.000Z`,
    kind,
    tool: kind === 'file_change' ? 'Write' : kind === 'command' ? 'Bash' : 'WebFetch',
    features,
    displayMasked: `op ${seq}`,
    logSequence: seq * 10,
  };
}

/** Categories of executed operations only (declared-but-unused entries excluded). */
const opCategories = (r: ReturnType<typeof classifyOperations>) =>
  r.entries.filter((e) => e.seq !== undefined).map((e) => e.category);

describe('classifyOperations', () => {
  test('ambiguous declaration is not used for judging', () => {
    const r = classifyOperations(
      decl({ commands: ['git'] }),
      [op('command', { commandNames: ['rm'] })],
      true,
    );
    expect(r.status).toBe('ambiguous');
    expect(r.entries).toEqual([]);
    expect(r.counts).toBeNull();
    expect(r.byKind).toBeNull();
  });

  test('classifies file changes into in_plan / out_of_plan', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'] }),
      [op('file_change', { path: 'src/a.ts' }), op('file_change', { path: 'docs/b.md' })],
      false,
    );
    expect(r.entries.map((e) => e.category)).toEqual(['in_plan', 'out_of_plan']);
    expect(r.counts).toEqual({ inPlan: 1, outOfPlan: 1, plannedNotExecuted: 0 });
  });

  test('commands match by name only; always-allowed names are ignored', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'], commands: ['git'] }),
      [
        op('command', { commandNames: ['cd', 'git', 'head'] }),
        op('command', { commandNames: ['git', 'rm'] }),
      ],
      false,
    );
    expect(opCategories(r)).toEqual(['in_plan', 'out_of_plan']);
  });

  test('commands are skipped when the plan declares none', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'] }),
      [op('command', { commandNames: ['rm'] })],
      true,
    );
    expect(r.entries[0].category).toBe('skipped');
    expect(r.counts?.outOfPlan).toBe(0);
  });

  test('only undeclared non-loopback hosts are out_of_plan', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'], externalHosts: ['*.example.com', 'api.github.com'] }),
      [
        op('http', { hosts: ['docs.example.com'] }),
        op('http', { hosts: ['127.0.0.1', 'localhost'] }),
        op('http', { hosts: ['api.github.com'] }),
        op('http', { hosts: ['evil.test'] }),
        op('http', { hosts: ['example.com'] }),
      ],
      false,
    );
    expect(opCategories(r)).toEqual([
      'in_plan',
      'in_plan',
      'in_plan',
      'out_of_plan',
      'out_of_plan',
    ]);
  });

  test('declared-but-unused items are planned_not_executed only when the execution ended', () => {
    const ops = [op('file_change', { path: 'src/a.ts' })];
    const d = decl({ files: ['src/**', 'docs/**'], commands: ['bun'], externalHosts: ['x.com'] });
    const done = classifyOperations(d, ops, true);
    const unexec = done.entries.filter((e) => e.category === 'planned_not_executed');
    expect(unexec.map((e) => e.declaredItem)).toEqual(['docs/**', 'bun', 'x.com']);
    expect(done.counts).toEqual({ inPlan: 1, outOfPlan: 0, plannedNotExecuted: 3 });
    expect(done.byKind).toEqual({ file_change: 1, command: 1, http: 1 });

    const running = classifyOperations(d, ops, false);
    expect(running.entries.filter((e) => e.category === 'pending')).toHaveLength(3);
    expect(running.counts?.plannedNotExecuted).toBe(0);
  });

  test('entries are ordered by occurredAt then seq', () => {
    const a = op('file_change', { path: 'src/a.ts' }, '2026-10-13T00:00:05.000Z');
    const b = op('file_change', { path: 'src/b.ts' }, '2026-10-13T00:00:01.000Z');
    const c = op('file_change', { path: 'src/c.ts' }, '2026-10-13T00:00:01.000Z');
    const r = classifyOperations(decl({ files: ['src/**'] }), [a, c, b], false);
    expect(r.entries.map((e) => e.seq)).toEqual([b.seq, c.seq, a.seq]);
  });

  test('Windows absolute paths match relative declarations via workDir', () => {
    const r = classifyOperations(
      decl({ files: ['rapitas-backend/**'] }),
      [op('file_change', { path: 'C:\\w\\task\\rapitas-backend\\x.ts' })],
      false,
      'C:\\w\\task',
    );
    expect(r.entries[0].category).toBe('in_plan');
  });
});

// Audit 2026-11-17 (tasks 1349, 1357): the workflow's own scratch files and the
// junk names old recordings stored for shell syntax counted as deviations.
describe('classifyOperations — what is never a deviation', () => {
  test('the workflow scratch files at the worktree root are in plan', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'] }),
      [
        op('file_change', { path: '.wf-t1349-verify-r3.md' }),
        op('file_change', { path: 'C:/wt/task-1/.wf-evidence-1.json' }),
      ],
      true,
      'C:/wt/task-1',
    );
    expect(opCategories(r)).toEqual(['in_plan', 'in_plan']);
  });

  test('names recorded for redirects, heredoc bodies and options are ignored', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'], commands: ['bun'] }),
      [op('command', { commandNames: ['bun', '1', 'eof', 'const', '--data-binary', '調査'] })],
      true,
    );
    expect(opCategories(r)).toEqual(['in_plan']);
  });
});

// Audit 2026-11-17, after the parser fix: older recordings still carried
// names cut from python heredoc bodies (`tests`, `assert`, `n').write(s`), so
// command names are read again from the recorded command line.
describe('classifyOperations — command names read from the recorded command', () => {
  const bash = (display: string, stored: string[]): OperationRecord => ({
    ...op('command', { commandNames: stored }),
    displayMasked: `Bash: ${display}`,
  });

  test('names stored from a heredoc body are not judged', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'], commands: ['python'] }),
      [
        bash("python - <<'EOF'\nimport re\nassert tests\nEOF", [
          'python',
          'import',
          'assert',
          'tests',
        ]),
      ],
      true,
    );
    expect(opCategories(r)).toEqual(['in_plan']);
  });

  // The workflow tells every agent to save its files through curl to the
  // local API; that is the system's own channel, not the plan's work.
  test('curl to the local backend is in plan; curl elsewhere is not', () => {
    const r = classifyOperations(
      decl({ files: ['src/**'], commands: ['bun'] }),
      [
        bash('curl -s -X PUT http://127.0.0.1:3001/workflow/tasks/5/files/verify', ['curl']),
        bash('curl -s https://example.com/x', ['curl']),
      ],
      true,
    );
    expect(opCategories(r)).toEqual(['in_plan', 'out_of_plan']);
  });
});
