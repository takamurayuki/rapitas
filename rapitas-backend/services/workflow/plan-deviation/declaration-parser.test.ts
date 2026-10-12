/**
 * declaration-parser tests
 */
import { describe, expect, test } from 'bun:test';
import { parsePlanDeclaration, hashDeclaration } from './declaration-parser';

const fence = (body: string) => '```json:plan-declaration\n' + body + '\n```';

describe('parsePlanDeclaration', () => {
  test('reads the json:plan-declaration fence', () => {
    const plan = `# 計画\n\n${fence(
      JSON.stringify({
        version: 1,
        files: ['rapitas-backend/**'],
        commands: ['bun', 'git'],
        externalHosts: ['registry.npmjs.org'],
      }),
    )}\n`;
    const r = parsePlanDeclaration(plan);
    expect(r.source).toBe('fence');
    expect(r.ambiguous).toBe(false);
    expect(r.declaration.files).toEqual(['rapitas-backend/**']);
    expect(r.declaration.commands).toEqual(['bun', 'git']);
    expect(r.declaration.externalHosts).toEqual(['registry.npmjs.org']);
    expect(r.warnings).toEqual([]);
  });

  test('a fence with zero file patterns is ambiguous', () => {
    const r = parsePlanDeclaration(
      fence(JSON.stringify({ version: 1, files: [], commands: ['bun'] })),
    );
    expect(r.ambiguous).toBe(true);
    expect(r.declaration.commands).toEqual(['bun']);
  });

  test('without a fence, only files are filled from the 変更予定ファイル section', () => {
    const plan = '## 変更予定ファイル\n\n- `src/a.ts`\n- `src/dir/`\n\n## その他\n`bun test x`\n';
    const r = parsePlanDeclaration(plan);
    expect(r.source).toBe('fallback');
    expect(r.declaration.files).toEqual(['src/a.ts', 'src/dir/']);
    expect(r.declaration.commands).toEqual([]);
    expect(r.declaration.externalHosts).toEqual([]);
    expect(r.ambiguous).toBe(false);
  });

  test('no fence and no declared files → ambiguous', () => {
    const r = parsePlanDeclaration('# 計画\n\n特になし');
    expect(r.source).toBe('none');
    expect(r.ambiguous).toBe(true);
  });

  test('empty / null plan → ambiguous', () => {
    expect(parsePlanDeclaration(null).ambiguous).toBe(true);
    expect(parsePlanDeclaration('').ambiguous).toBe(true);
  });

  test('broken JSON fence falls back and records a warning', () => {
    const plan = `${fence('{"files": [oops')}\n\n## 変更予定ファイル\n- \`src/a.ts\`\n`;
    const r = parsePlanDeclaration(plan);
    expect(r.source).toBe('fallback');
    expect(r.declaration.files).toEqual(['src/a.ts']);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('plan-declaration');
  });

  test('non-string entries are dropped and the first fence wins', () => {
    const plan = `${fence('{"files":["a/**", 3, ""],"commands":"bun"}')}\n${fence('{"files":["b/**"]}')}`;
    const r = parsePlanDeclaration(plan);
    expect(r.declaration.files).toEqual(['a/**']);
    expect(r.declaration.commands).toEqual([]);
  });
});

describe('hashDeclaration', () => {
  test('is stable and differs per declaration', () => {
    const a = { version: 1 as const, files: ['a'], commands: [], externalHosts: [] };
    const b = { ...a, files: ['b'] };
    expect(hashDeclaration(a)).toBe(hashDeclaration({ ...a }));
    expect(hashDeclaration(a)).not.toBe(hashDeclaration(b));
    expect(hashDeclaration(a)).toHaveLength(16);
  });
});
