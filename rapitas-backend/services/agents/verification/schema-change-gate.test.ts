/**
 * schema-change-gate テスト
 *
 * 非該当/未計画NG/計画済+override済OK/計画済のみoverride省略NG(883回帰)/
 * unplanned+override混在NG/生成物パス除外/パス区切り正規化/isSchemaFilePath/
 * resolveForbiddenChangeOverrideのDB失敗時フェイルクローズを検証する。
 */
import { describe, it, expect, mock } from 'bun:test';

let findUniqueImpl: (args: unknown) => Promise<{ forbiddenChangeOverride: boolean } | null>;

mock.module('../../../config/database', () => ({
  prisma: {
    task: {
      findUnique: (args: unknown) => findUniqueImpl(args),
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => {
  const noop = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});

const { schemaChangeGateCheck, isSchemaFilePath, resolveForbiddenChangeOverride } =
  await import('./schema-change-gate');

describe('isSchemaFilePath', () => {
  it('prisma/schema/*.prisma を true と判定する', () => {
    expect(isSchemaFilePath('rapitas-backend/prisma/schema/pause.prisma')).toBe(true);
  });

  it('生成物パス prisma/schema.desktop/ は false と判定する', () => {
    expect(isSchemaFilePath('rapitas-backend/prisma/schema.desktop/pause.prisma')).toBe(false);
  });

  it('Windowsパス区切り(\\\\)混入時も正規化して判定する', () => {
    expect(isSchemaFilePath('rapitas-backend\\prisma\\schema\\pause.prisma')).toBe(true);
  });
});

describe('schemaChangeGateCheck', () => {
  it('prisma/schema/ 配下の変更が無ければ null を返す', () => {
    expect(schemaChangeGateCheck(['src/foo.ts', 'src/bar.test.ts'], null)).toBeNull();
  });

  it('未計画のスキーマ変更は override の有無に関わらず ok:false, errorCount:1 を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['src/foo.ts'],
      true,
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.name).toBe('schema-change');
    expect(result?.details).toContain('rapitas-backend/prisma/schema/pause.prisma');
  });

  it('883回帰: plan.mdに明記されたスキーマ変更でも override 省略時は ok:false を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.details).toContain('forbiddenChangeOverride');
  });

  it('plan.mdに明記かつ override:true のスキーマ変更は ok:true を返す', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
      true,
    );
    expect(result?.ok).toBe(true);
    expect(result?.errorCount).toBe(0);
  });

  it('未計画変更が含まれる場合、override:true でも ok:false を返す（overrideは計画内変更にしか効かない）', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      ['src/foo.ts'],
      true,
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
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
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma'],
      null,
      true,
    );
    expect(result?.ok).toBe(false);
  });

  it('計画済み1件・未計画1件が混在する場合、未計画分のみerrorCountに計上する', () => {
    const result = schemaChangeGateCheck(
      ['rapitas-backend/prisma/schema/pause.prisma', 'rapitas-backend/prisma/schema/agents.prisma'],
      ['rapitas-backend/prisma/schema/pause.prisma'],
      true,
    );
    expect(result?.ok).toBe(false);
    expect(result?.errorCount).toBe(1);
    expect(result?.details).toContain('agents.prisma');
    expect(result?.details).not.toContain('pause.prisma');
  });
});

describe('resolveForbiddenChangeOverride', () => {
  it('taskId が undefined の場合は false を返す', async () => {
    expect(await resolveForbiddenChangeOverride(undefined)).toBe(false);
  });

  it('DBに forbiddenChangeOverride:true が保存されていれば true を返す', async () => {
    findUniqueImpl = () => Promise.resolve({ forbiddenChangeOverride: true });
    expect(await resolveForbiddenChangeOverride(1059)).toBe(true);
  });

  it('DBに forbiddenChangeOverride:false が保存されていれば false を返す', async () => {
    findUniqueImpl = () => Promise.resolve({ forbiddenChangeOverride: false });
    expect(await resolveForbiddenChangeOverride(1059)).toBe(false);
  });

  it('DB読み取りが例外を投げた場合は false(フェイルクローズ)を返す', async () => {
    findUniqueImpl = () => Promise.reject(new Error('DB down'));
    expect(await resolveForbiddenChangeOverride(1059)).toBe(false);
  });

  it('タスクが存在しない(null)場合は false を返す', async () => {
    findUniqueImpl = () => Promise.resolve(null);
    expect(await resolveForbiddenChangeOverride(1059)).toBe(false);
  });
});
