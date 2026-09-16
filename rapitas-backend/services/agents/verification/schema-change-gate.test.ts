/**
 * schema-change-gate テスト
 *
 * 非該当/未計画NG/生成物パス除外/パス区切り正規化に加え、task896で追加した
 * 「計画済みでも上書きなしはNG（883回帰）」「他リポジトリはスキップ」
 * 「上書き成立でOK」「未宣言は上書きでも救済されない」を検証する。
 */
import { describe, it, expect } from 'bun:test';
import {
  schemaChangeGateCheck,
  isSelfRepoThemeWorkingDirectory,
  evaluatePlanDeclaredForbiddenChange,
} from './schema-change-gate';

describe('schemaChangeGateCheck', () => {
  it('prisma/schema/ 配下の変更が無ければ null を返す', () => {
    expect(schemaChangeGateCheck(['src/foo.ts', 'src/bar.test.ts'], null)).toBeNull();
  });

  it('未計画のスキーマ変更は ok:false, errorCount:1 を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['src/foo.ts'],
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.name).toBe('schema-change');
    expect(result?.details).toContain('rapitas-backend/prisma/schema/pause.prisma');
  });

  it('883回帰: plan.mdに明記されていても明示上書きが無ければ ok:false を返す（既定のfail-closed）', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
  });

  it('明示ユーザー上書きが成立していれば計画済みスキーマ変更は ok:true を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
      { isSelfRepo: true, overrideGranted: true },
    );
    expect(result?.ok).toBe(true);
    expect(result?.errorCount).toBe(0);
  });

  it('未宣言のスキーマ変更は明示上書きがあっても ok:false のまま（上書きは宣言済みにのみ適用）', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['src/foo.ts'],
      { isSelfRepo: true, overrideGranted: true },
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
  });

  it('他リポジトリ（isSelfRepo:false）はスキーマ変更があっても ok:true でスキップされる', () => {
    const result = schemaChangeGateCheck(['rapitas-backend/prisma/schema/pause.prisma'], null, {
      isSelfRepo: false,
      overrideGranted: false,
    });
    expect(result?.ok).toBe(true);
    expect(result?.errorCount).toBe(0);
  });

  it('生成物パス prisma/schema.desktop/ は非該当（null）', () => {
    expect(
      schemaChangeGateCheck(['rapitas-backend/prisma/schema.desktop/pause.prisma'], null),
    ).toBeNull();
  });

  it('Windowsパス区切り(\\\\)混入時も正規化して判定できる', () => {
    const result = schemaChangeGateCheck(['rapitas-backend\\prisma\\schema\\pause.prisma'], null);
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
  });

  it('planFilesがnull（軽量モード）の場合は無条件で未計画扱い', () => {
    const result = schemaChangeGateCheck(['rapitas-backend/prisma/schema/pause.prisma'], null);
    expect(result?.ok).toBe(false);
  });

  it('計画済み1件・未計画1件が混在する場合、未計画分のみerrorCountに計上する', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma', 'rapitas-backend/prisma/schema/agents.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.details).toContain('agents.prisma');
    expect(result?.details).not.toContain('pause.prisma');
  });
});

describe('isSelfRepoThemeWorkingDirectory', () => {
  it('null/undefined/空文字は自己リポジトリ扱い（true）', () => {
    expect(isSelfRepoThemeWorkingDirectory(null)).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory(undefined)).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory('')).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory('   ')).toBe(true);
  });

  it('非空文字列は他リポジトリ扱い（false）', () => {
    expect(isSelfRepoThemeWorkingDirectory('C:/other-project')).toBe(false);
  });
});

describe('evaluatePlanDeclaredForbiddenChange', () => {
  it('plan.mdに禁止パターン該当なしなら ok:true, matchedFiles:[]', () => {
    const result = evaluatePlanDeclaredForbiddenChange('## 変更予定ファイル\n- `src/foo.ts`', {
      isSelfRepo: true,
      overrideGranted: false,
    });
    expect(result.ok).toBe(true);
    expect(result.matchedFiles).toEqual([]);
  });

  it('883再現: 禁止パターン該当かつ上書きなしなら ok:false', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n- `rapitas-backend/prisma/schema/pause.prisma`',
      { isSelfRepo: true, overrideGranted: false },
    );
    expect(result.ok).toBe(false);
    expect(result.matchedFiles).toEqual(['rapitas-backend/prisma/schema/pause.prisma']);
  });

  it('禁止パターン該当でも上書き成立なら ok:true', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n- `rapitas-backend/prisma/schema/pause.prisma`',
      { isSelfRepo: true, overrideGranted: true },
    );
    expect(result.ok).toBe(true);
  });

  it('他リポジトリ（isSelfRepo:false）なら禁止パターン該当でも ok:true', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n- `rapitas-backend/prisma/schema/pause.prisma`',
      { isSelfRepo: false, overrideGranted: false },
    );
    expect(result.ok).toBe(true);
    expect(result.matchedFiles).toEqual([]);
  });
});
