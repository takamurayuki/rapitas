/**
 * workflow-file-size-context.test.ts
 *
 * Unit tests for the implementer file-size awareness section (task 600).
 * Uses mkdtempSync fixture repos — no DB, no mocks.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classifyFileSizeRows,
  formatFileSizeAwarenessSection,
  buildFileSizeAwarenessSection,
} from './workflow-file-size-context';

let repoRoot: string;

function writeFixture(relPath: string, lines: number): void {
  const abs = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, 'const x = 1;\n'.repeat(lines));
}

beforeAll(() => {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), 'wfsc-fixture-'));
  writeFixture('rapitas-backend/services/workflow/huge.ts', 700); // hard
  writeFixture('rapitas-backend/services/workflow/mid.ts', 350); // soft
  writeFixture('rapitas-backend/services/workflow/small.ts', 100); // within
  writeFixture('rapitas-frontend/src/components/big-panel.tsx', 600); // hard, frontend
});

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('classifyFileSizeRows', () => {
  test('detects a hard-limit breach with the current line count', () => {
    const rows = classifyFileSizeRows(repoRoot, ['services/workflow/huge.ts']);
    expect(rows).toEqual([
      {
        planPath: 'services/workflow/huge.ts',
        resolvedPath: 'rapitas-backend/services/workflow/huge.ts',
        lines: 700,
        severity: 'hard',
      },
    ]);
  });

  test('detects a soft-limit breach', () => {
    const rows = classifyFileSizeRows(repoRoot, ['services/workflow/mid.ts']);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('soft');
    expect(rows[0].lines).toBe(350);
  });

  test('ignores files within limits', () => {
    expect(classifyFileSizeRows(repoRoot, ['services/workflow/small.ts'])).toEqual([]);
  });

  test('skips directory tokens (trailing slash)', () => {
    expect(classifyFileSizeRows(repoRoot, ['services/workflow/'])).toEqual([]);
  });

  test('skips unresolvable paths (fail open)', () => {
    expect(classifyFileSizeRows(repoRoot, ['does/not/exist.ts'])).toEqual([]);
  });

  test('resolves rapitas-frontend/src-relative paths', () => {
    const rows = classifyFileSizeRows(repoRoot, ['components/big-panel.tsx']);
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedPath).toBe('rapitas-frontend/src/components/big-panel.tsx');
    expect(rows[0].severity).toBe('hard');
  });

  test('dedupes repo-relative and package-relative references to the same file', () => {
    const rows = classifyFileSizeRows(repoRoot, [
      'services/workflow/huge.ts',
      'rapitas-backend/services/workflow/huge.ts',
    ]);
    expect(rows).toHaveLength(1);
  });

  test('sorts largest first', () => {
    const rows = classifyFileSizeRows(repoRoot, [
      'services/workflow/mid.ts',
      'services/workflow/huge.ts',
    ]);
    expect(rows.map((r) => r.lines)).toEqual([700, 350]);
  });
});

describe('formatFileSizeAwarenessSection', () => {
  test('empty rows → empty string', () => {
    expect(formatFileSizeAwarenessSection([], 'ja')).toBe('');
  });

  test('renders the heading, path, line count and policy reference', () => {
    const section = formatFileSizeAwarenessSection(
      [
        {
          planPath: 'services/workflow/huge.ts',
          resolvedPath: 'rapitas-backend/services/workflow/huge.ts',
          lines: 700,
          severity: 'hard',
        },
      ],
      'ja',
    );
    expect(section).toContain('変更対象ファイルの行数状況');
    expect(section).toContain('rapitas-backend/services/workflow/huge.ts');
    expect(section).toContain('700 行');
    expect(section).toContain('hard 上限(500行)');
    expect(section).toContain('COMPONENT_SPLITTING_POLICY.md');
  });
});

describe('buildFileSizeAwarenessSection', () => {
  test('plan referencing no over-limit files → empty string', () => {
    const plan = '変更予定: `services/workflow/small.ts` のみ。';
    expect(buildFileSizeAwarenessSection(plan, 'ja', repoRoot)).toBe('');
  });

  test('plan referencing an over-limit file → section with path and lines', () => {
    const plan =
      '## 変更予定ファイル\n\n| ファイル | 種別 |\n|---|---|\n| `services/workflow/huge.ts` | 変更 |\n';
    const section = buildFileSizeAwarenessSection(plan, 'ja', repoRoot);
    expect(section).toContain('rapitas-backend/services/workflow/huge.ts');
    expect(section).toContain('700 行');
  });

  test('broken plan content does not throw and returns a string', () => {
    expect(() => buildFileSizeAwarenessSection('```\n`\n``` ` `` ', 'ja', repoRoot)).not.toThrow();
    expect(typeof buildFileSizeAwarenessSection('', 'ja', repoRoot)).toBe('string');
  });
});
