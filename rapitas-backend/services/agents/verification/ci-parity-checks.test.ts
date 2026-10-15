/**
 * ciParityChecks テスト — 偽の rapitas-backend/package.json に drift 検査スクリプトを
 * 置き、task 1031(2026-09-22)の「ローカル緑 → CI の Check type-guard drift 赤」を再現して、
 * backend の TS を触った差分では drift が generated-sync として失敗し、触っていない差分や
 * スクリプトの無いリポジトリでは走らないことを検証する。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciParityChecks } from './generated-sync-check';

let root = '';
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ci-parity-'));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function fakeBackend(dir: string, scripts: Record<string, string>): void {
  mkdirSync(join(dir, 'rapitas-backend'), { recursive: true });
  writeFileSync(
    join(dir, 'rapitas-backend', 'package.json'),
    JSON.stringify({ name: 'fake-backend', scripts }),
  );
}

const ok = 'node -e "console.log(\'no drift detected.\')"';
const drift =
  'node -e "console.error(\'DRIFT [modified]: src/generated/type-guards.ts\'); process.exit(1)"';

describe('ciParityChecks', () => {
  test('type-guard drift は generated-sync の失敗として報告し、再生成コマンドを案内する', async () => {
    const dir = join(root, 'drift');
    fakeBackend(dir, {
      'check:boundary-guide': ok,
      'check:type-guards': drift,
      'generate:route-barrels:check': ok,
    });
    const checks = await ciParityChecks(dir, ['rapitas-backend/services/x.ts']);
    const sync = checks.find((c) => c.name === 'generated-sync');
    expect(sync?.ran).toBe(true);
    expect(sync?.ok).toBe(false);
    expect(sync?.errorCount).toBe(1);
    expect(sync?.details).toContain('type guards');
    expect(sync?.details).toContain('DRIFT [modified]: src/generated/type-guards.ts');
    expect(sync?.details).toContain('bun run gen:type-guards');
  });

  test('全て同期していれば合格', async () => {
    const dir = join(root, 'clean');
    fakeBackend(dir, {
      'check:boundary-guide': ok,
      'check:type-guards': ok,
      'generate:route-barrels:check': ok,
    });
    const checks = await ciParityChecks(dir, ['rapitas-backend\\routes\\y.ts']);
    const sync = checks.find((c) => c.name === 'generated-sync');
    expect(sync?.ok).toBe(true);
  });

  test('backend の TS を触らない差分では drift 検査を走らせない', async () => {
    const dir = join(root, 'frontend-only');
    fakeBackend(dir, { 'check:type-guards': drift });
    const checks = await ciParityChecks(dir, ['rapitas-frontend/src/app/page.tsx', 'docs/a.md']);
    expect(checks.find((c) => c.name === 'generated-sync')).toBeUndefined();
  });

  test('スクリプトが無いリポジトリでは何も追加しない', async () => {
    const dir = join(root, 'other-repo');
    mkdirSync(dir, { recursive: true });
    expect(await ciParityChecks(dir, ['src/a.ts'])).toEqual([]);
  });
});
