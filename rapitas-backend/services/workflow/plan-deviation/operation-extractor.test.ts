/**
 * operation-extractor tests
 */
import { describe, expect, test } from 'bun:test';
import { extractOperations, splitCommandNames, extractUrlHosts } from './operation-extractor';

describe('splitCommandNames', () => {
  const cases: Array<[string, string[]]> = [
    ['git status', ['git']],
    ['cd x && git status | head -5', ['cd', 'git', 'head']],
    ['FOO=1 BAR=2 bun test a.ts; echo done', ['bun', 'echo']],
    ['C:\\tools\\curl.exe -s http://x', ['curl']],
    ['/usr/bin/git log\nnpm run build', ['git', 'npm']],
    ['(cd a || ls) ', ['cd', 'ls']],
    ['"git" status', ['git']],
    ['', []],
  ];
  for (const [cmd, expected] of cases) {
    test(JSON.stringify(cmd), () => {
      expect(splitCommandNames(cmd)).toEqual(expected);
    });
  }
});

describe('extractUrlHosts', () => {
  test('extracts lower-case hosts without userinfo or port', () => {
    expect(
      extractUrlHosts('curl https://User:pw@API.Example.com:8443/x && wget http://127.0.0.1:3001/a'),
    ).toEqual(['api.example.com', '127.0.0.1']);
  });
  test('no URL → []', () => {
    expect(extractUrlHosts('git status')).toEqual([]);
  });
});

describe('extractOperations', () => {
  test('file-modifying tools become file_change', () => {
    expect(extractOperations('Write', { file_path: 'src/a.ts', content: 'x' })).toEqual([
      { kind: 'file_change', tool: 'Write', features: { path: 'src/a.ts' }, summary: 'src/a.ts' },
    ]);
    expect(extractOperations('Edit', { file_path: 'b.ts' })[0].kind).toBe('file_change');
    expect(extractOperations('MultiEdit', { file_path: 'b.ts' })[0].kind).toBe('file_change');
    expect(extractOperations('NotebookEdit', { notebook_path: 'n.ipynb' })[0].features.path).toBe(
      'n.ipynb',
    );
  });

  test('read-only tools are not recorded', () => {
    expect(extractOperations('Read', { file_path: 'a.ts' })).toEqual([]);
    expect(extractOperations('Grep', { pattern: 'x' })).toEqual([]);
    expect(extractOperations('Glob', { pattern: '**' })).toEqual([]);
  });

  test('Bash yields a command op, plus an http op when URLs appear', () => {
    const ops = extractOperations('Bash', { command: 'cd x && curl https://evil.example/x' });
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ kind: 'command', features: { commandNames: ['cd', 'curl'] } });
    expect(ops[1]).toMatchObject({ kind: 'http', features: { hosts: ['evil.example'] } });
  });

  test('WebFetch yields http', () => {
    expect(extractOperations('WebFetch', { url: 'https://docs.example.com/p' })).toEqual([
      {
        kind: 'http',
        tool: 'WebFetch',
        features: { hosts: ['docs.example.com'] },
        summary: 'https://docs.example.com/p',
      },
    ]);
  });

  test('malformed input is ignored', () => {
    expect(extractOperations('Write', null)).toEqual([]);
    expect(extractOperations('Bash', { command: 3 })).toEqual([]);
  });
});
