/**
 * gen-shutdown-error-artifacts.test
 *
 * Verifies that the committed generated artifacts match what the generator
 * would produce from the current SSOT. Any drift (file missing or content
 * changed after a SSOT edit without re-running `bun run gen:shutdown-error`)
 * causes this test to fail, keeping CI red until the artifacts are regenerated
 * and committed.
 *
 * The changelog (`docs/shutdown-error-changelog.md`) is intentionally excluded
 * from drift checks because it contains timestamps. Only the deterministic
 * artifacts (generated test + spec) are compared.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import {
  checkDrift,
  generateTestFileContent,
  generateSpecContent,
  GENERATED_TEST_PATH,
  SPEC_PATH,
  CHANGELOG_PATH,
} from './gen-shutdown-error-artifacts';

describe('生成アーティファクト ドリフトガード', () => {
  test('生成テストとspec.mdがSSOTと一致する（ドリフトなし）', () => {
    const drifts = checkDrift();
    if (drifts.length > 0) {
      const messages = drifts.map((d) => `${d.status}: ${d.file}`).join('\n');
      throw new Error(
        `Drift detected. Run \`bun run gen:shutdown-error\` and commit:\n${messages}`,
      );
    }
    expect(drifts).toEqual([]);
  });

  test('changelogはdrift比較から除外される', () => {
    const drifts = checkDrift();
    const paths = drifts.map((d) => d.file);
    expect(paths.every((p) => !p.includes('changelog'))).toBe(true);
  });
});

describe('generateTestFileContent', () => {
  test('全SHUTDOWNアクションが生成内容に含まれる', () => {
    const content = generateTestFileContent();
    for (const action of ['start new execution', 'continue execution', 'resume execution']) {
      expect(content).toContain(action);
    }
  });

  test('生成内容がディスク上のファイルと一致する', () => {
    const generated = generateTestFileContent();
    const onDisk = readFileSync(GENERATED_TEST_PATH, 'utf-8');
    expect(onDisk).toBe(generated);
  });
});

describe('generateSpecContent', () => {
  test('HTTPステータスコードの注意書きが含まれる', () => {
    const content = generateSpecContent();
    expect(content).toContain('503 Service Unavailable');
    expect(content).toContain('未統一');
  });

  test('生成内容がディスク上のファイルと一致する', () => {
    const generated = generateSpecContent();
    const onDisk = readFileSync(SPEC_PATH, 'utf-8');
    expect(onDisk).toBe(generated);
  });
});

describe('CHANGELOG_PATH', () => {
  test('changelogパスは docs/ 配下を指す', () => {
    expect(CHANGELOG_PATH).toContain('docs');
    expect(CHANGELOG_PATH).toContain('changelog');
  });
});
