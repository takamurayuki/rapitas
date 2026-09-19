/**
 * schema-change-gate テスト
 *
 * 非該当/未計画NG/上書きなし計画済NG(883回帰)/上書きあり計画済OK/他リポジトリスキップ/
 * 生成物パス除外/パス区切り正規化の分岐を検証する。
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

  it('883回帰: plan.mdに明記されたスキーマ変更でも上書きなしなら ok:false を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.details).toContain('明示ユーザー上書き');
  });

  it('計画済み+明示ユーザー上書き(overrideGranted:true)なら ok:true を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
      { overrideGranted: true },
    );
    expect(result?.ok).toBe(true);
    expect(result?.errorCount).toBe(0);
  });

  it('未計画の変更は overrideGranted:true でも救済されない', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['src/foo.ts'],
      { overrideGranted: true },
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
  });

  it('isSelfRepo:false（他リポジトリ）ならスキーマ変更を検出してもスキップ(ok:true)する', () => {
    const result = schemaChangeGateCheck(['rapitas-backend/prisma/schema/pause.prisma'], null, {
      isSelfRepo: false,
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
  it('null/undefined/空文字は自リポジトリ(true)と判定する', () => {
    expect(isSelfRepoThemeWorkingDirectory(null)).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory(undefined)).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory('')).toBe(true);
    expect(isSelfRepoThemeWorkingDirectory('   ')).toBe(true);
  });

  it('非空文字列は他リポジトリ(false)と判定する', () => {
    expect(isSelfRepoThemeWorkingDirectory('/path/to/other-repo')).toBe(false);
  });
});

describe('evaluatePlanDeclaredForbiddenChange', () => {
  it('禁止パターンに該当する宣言が無ければ ok:true, matchedFiles:[] を返す', () => {
    const result = evaluatePlanDeclaredForbiddenChange('## 変更予定ファイル\n\n- `src/foo.ts`\n');
    expect(result.ok).toBe(true);
    expect(result.matchedFiles).toEqual([]);
  });

  it('883回帰: 宣言に禁止パターンがあり上書きなしなら ok:false を返す', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n\n- `rapitas-backend/prisma/schema/pause.prisma`\n',
    );
    expect(result.ok).toBe(false);
    expect(result.matchedFiles).toEqual(['rapitas-backend/prisma/schema/pause.prisma']);
  });

  it('宣言に禁止パターンがあり明示上書きありなら ok:true を返す', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n\n- `rapitas-backend/prisma/schema/pause.prisma`\n',
      { overrideGranted: true },
    );
    expect(result.ok).toBe(true);
    expect(result.matchedFiles).toEqual(['rapitas-backend/prisma/schema/pause.prisma']);
  });

  it('他リポジトリ(isSelfRepo:false)なら禁止パターンがあってもスキップする', () => {
    const result = evaluatePlanDeclaredForbiddenChange(
      '## 変更予定ファイル\n\n- `rapitas-backend/prisma/schema/pause.prisma`\n',
      { isSelfRepo: false },
    );
    expect(result.ok).toBe(true);
    expect(result.matchedFiles).toEqual([]);
  });
});
