/**
 * tamperCheck / looksLikeBugFixTask / coverageCheck(force) テスト (R4)
 *
 * ゲート改変トリップワイヤ: 検証ゲート/CI/フックへの計画外変更を検出。
 * バグ修正検出と、coverage ゲートのタスク単位強制。
 */
import { describe, test, expect } from 'bun:test';
import {
  tamperCheck,
  looksLikeBugFixTask,
  coverageCheck,
} from '../../services/agents/verification/automated-verifier';

describe('tamperCheck', () => {
  test('保護パスに触れていなければ null', () => {
    expect(tamperCheck(['rapitas-backend/services/task/task-mutations.ts'], null)).toBeNull();
  });

  test('検証ゲート自身への計画外変更は不合格', () => {
    const c = tamperCheck(
      ['rapitas-backend/services/agents/verification/automated-verifier.ts'],
      null,
    );
    expect(c).not.toBeNull();
    expect(c!.name).toBe('tamper');
    expect(c!.ok).toBe(false);
    expect(c!.errorCount).toBe(1);
  });

  test('CIワークフロー・フックへの計画外変更も不合格', () => {
    const ci = tamperCheck(['.github/workflows/ci.yml'], []);
    expect(ci!.ok).toBe(false);
    const hook = tamperCheck(['.husky/pre-commit'], []);
    expect(hook!.ok).toBe(false);
    const script = tamperCheck(['scripts/pre-commit-check.cjs'], []);
    expect(script!.ok).toBe(false);
  });

  test('planに明記された保護ファイルの変更は合格（承認済み自己開発）', () => {
    const c = tamperCheck(
      ['rapitas-backend/services/agents/verification/adversarial-diff-review.ts'],
      ['rapitas-backend/services/agents/verification/adversarial-diff-review.ts'],
    );
    expect(c!.ok).toBe(true);
  });

  test('planに部分パスで書かれていても一致する', () => {
    const c = tamperCheck(
      ['rapitas-backend/services/agents/verification/adversarial-diff-review.ts'],
      ['services/agents/verification/adversarial-diff-review.ts'],
    );
    expect(c!.ok).toBe(true);
  });

  test('保護ファイルと通常ファイルの混在では保護分だけ数える', () => {
    const c = tamperCheck(
      ['rapitas-backend/services/x.ts', '.github/workflows/ci.yml', '.husky/pre-commit'],
      [],
    );
    expect(c!.ok).toBe(false);
    expect(c!.errorCount).toBe(2);
  });
});

describe('looksLikeBugFixTask', () => {
  test('バグ/不具合/クラッシュ系の語で true', () => {
    expect(looksLikeBugFixTask('保存するとエラーになる不具合を直す')).toBe(true);
    expect(looksLikeBugFixTask('App crash on startup')).toBe(true);
    expect(looksLikeBugFixTask('一覧が表示されない')).toBe(true);
  });

  test('一般的な機能追加/修正では false（「修正」単独は対象外）', () => {
    expect(looksLikeBugFixTask('UIデザインの修正')).toBe(false);
    expect(looksLikeBugFixTask('新機能: ラベルフィルター追加')).toBe(false);
    expect(looksLikeBugFixTask(null)).toBe(false);
  });
});

describe('coverageCheck (force)', () => {
  test('env未設定でも force=true なら判定する', () => {
    delete process.env.RAPITAS_REQUIRE_TESTS;
    const c = coverageCheck(['rapitas-backend/services/x.ts'], true);
    expect(c).not.toBeNull();
    expect(c!.ok).toBe(false);
  });

  test('force=true でテストが伴っていれば合格', () => {
    delete process.env.RAPITAS_REQUIRE_TESTS;
    const c = coverageCheck(
      ['rapitas-backend/services/x.ts', 'rapitas-backend/tests/services/x.test.ts'],
      true,
    );
    expect(c!.ok).toBe(true);
  });
});
