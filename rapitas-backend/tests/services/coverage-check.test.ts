/**
 * coverageCheck テスト
 *
 * RAPITAS_REQUIRE_TESTS=1 のとき、ソース変更にテストが伴わなければ不合格。
 * 既定（未設定）は null（チェックしない）。テスト/宣言/設定のみは対象外。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { coverageCheck } from '../../services/agents/verification/automated-verifier';

const prev = process.env.RAPITAS_REQUIRE_TESTS;
afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_REQUIRE_TESTS;
  else process.env.RAPITAS_REQUIRE_TESTS = prev;
});

describe('coverageCheck', () => {
  test('既定（未設定）は null を返す（オプトイン）', () => {
    delete process.env.RAPITAS_REQUIRE_TESTS;
    expect(coverageCheck(['rapitas-backend/services/x.ts'])).toBeNull();
  });

  test('有効＋ソース変更にテスト無し → 不合格', () => {
    process.env.RAPITAS_REQUIRE_TESTS = '1';
    const c = coverageCheck(['rapitas-backend/services/x.ts', 'rapitas-backend/services/y.ts']);
    expect(c).not.toBeNull();
    expect(c!.name).toBe('coverage');
    expect(c!.ok).toBe(false);
    expect(c!.errorCount).toBe(1);
  });

  test('有効＋テストも変更されていれば合格', () => {
    process.env.RAPITAS_REQUIRE_TESTS = '1';
    const c = coverageCheck([
      'rapitas-backend/services/x.ts',
      'rapitas-backend/tests/services/x.test.ts',
    ]);
    expect(c!.ok).toBe(true);
  });

  test('テストファイルのみの変更は対象外（null）', () => {
    process.env.RAPITAS_REQUIRE_TESTS = '1';
    expect(coverageCheck(['rapitas-backend/tests/services/x.test.ts'])).toBeNull();
  });

  test('宣言/設定ファイルのみは対象外（null）', () => {
    process.env.RAPITAS_REQUIRE_TESTS = '1';
    expect(coverageCheck(['types/foo.d.ts', 'vitest.config.ts'])).toBeNull();
  });
});
