/**
 * fileSizeRatchetCheck テスト — 偽の scripts/check-large-files.cjs を一時ディレクトリに
 * 置き、task 1027 の実データ（ベースライン 539 行のファイルが 546 行に増加）の出力形式で
 * 「この差分が触ったファイルの超過だけを失敗にする」ことを検証する。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSizeRatchetCheck } from './generated-sync-check';

const GREW_OUTPUT = [
  'Limits: soft 300 lines (warn), hard 500 lines (error)',
  'Mode: ratchet (baseline: 20 exempt files)',
  'Found: 19 hard, 282 soft',
  '',
  'Files over hard limit (must split — see COMPONENT_SPLITTING_POLICY.md):',
  '   1051  rapitas-backend/services/agents/verification/automated-verifier.ts  (baseline)',
  '    546  rapitas-backend/services/workflow/workflow-runner.ts  ← GREW (was 539)',
  '    512  rapitas-backend/services/other/untouched.ts  ← NEW',
];

let root = '';
function fakeScript(dir: string, lines: string[], exitCode: number): void {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'scripts', 'check-large-files.cjs'),
    `console.log(${JSON.stringify(lines.join('\n'))});\nprocess.exit(${exitCode});\n`,
  );
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ratchet-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fileSizeRatchetCheck', () => {
  test('スクリプトが無いリポジトリでは null（対象外）', async () => {
    const dir = join(root, 'no-script');
    mkdirSync(dir, { recursive: true });
    expect(await fileSizeRatchetCheck(dir, ['a.ts'])).toBeNull();
  });

  test('task 1027: 変更したベースラインファイルの増加は失敗、触っていない超過は不問', async () => {
    const dir = join(root, 'grew');
    fakeScript(dir, GREW_OUTPUT, 1);
    const r = await fileSizeRatchetCheck(dir, [
      'rapitas-backend\\services\\workflow\\workflow-runner.ts',
      'rapitas-backend/services/workflow/workflow-runner.errors.test.ts',
    ]);
    expect(r?.name).toBe('file-size');
    expect(r?.ran).toBe(true);
    expect(r?.ok).toBe(false);
    expect(r?.errorCount).toBe(1);
    expect(r?.details).toContain('workflow-runner.ts: 546 行（ベースライン 539 行から増加）');
    expect(r?.details).not.toContain('untouched.ts');
  });

  test('ベース側の既存超過だけなら合格（この差分の責任ではない）', async () => {
    const dir = join(root, 'preexisting');
    fakeScript(dir, GREW_OUTPUT, 1);
    const r = await fileSizeRatchetCheck(dir, ['rapitas-backend/services/foo.ts']);
    expect(r?.ok).toBe(true);
    expect(r?.errorCount).toBe(0);
    expect(r?.details).toContain('既存超過');
  });

  test('ratchet 合格（exit 0）はそのまま合格', async () => {
    const dir = join(root, 'clean');
    fakeScript(dir, ['✓ All files within size limits.'], 0);
    const r = await fileSizeRatchetCheck(dir, ['x.ts']);
    expect(r?.ok).toBe(true);
    expect(r?.ran).toBe(true);
  });
});
