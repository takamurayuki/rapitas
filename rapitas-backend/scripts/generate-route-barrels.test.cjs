/**
 * generate-route-barrels.test
 *
 * Unit tests for the route barrel generator: file discovery, alias
 * generation, manifest validation, and generated-source assembly.
 * Uses a temp directory tree so it never touches the real routes/ folder.
 */
const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  discoverRouteFiles,
  toAlias,
  toDomainConst,
  loadLegacyManifest,
  generateDomainBarrel,
} = require('./generate-route-barrels.cjs');

describe('discoverRouteFiles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-barrel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('正常系: *.routes.ts のみをパス昇順で返す', () => {
    fs.writeFileSync(path.join(tmpDir, 'b.routes.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'a.routes.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'not-a-route.ts'), '');

    const found = discoverRouteFiles(tmpDir);

    expect(found).toEqual(['a.routes.ts', 'b.routes.ts']);
  });

  it('異常系: 命名規約違反ファイル（.test.ts / helpers.ts）を除外する', () => {
    fs.writeFileSync(path.join(tmpDir, 'foo.routes.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'foo.routes.test.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'helpers.ts'), '');

    const found = discoverRouteFiles(tmpDir);

    expect(found).toEqual(['foo.routes.ts']);
  });

  it('境界値: ネストしたサブディレクトリも再帰的に走査する', () => {
    fs.mkdirSync(path.join(tmpDir, 'nested'));
    fs.writeFileSync(path.join(tmpDir, 'top.routes.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'nested', 'child.routes.ts'), '');

    const found = discoverRouteFiles(tmpDir);

    expect(found).toEqual(['nested/child.routes.ts', 'top.routes.ts']);
  });

  it('境界値: ディレクトリが存在しない場合は空配列を返す', () => {
    const found = discoverRouteFiles(path.join(tmpDir, 'does-not-exist'));

    expect(found).toEqual([]);
  });
});

describe('toAlias', () => {
  it('通常変換: kebab-case ファイル名を camelCase + Route に変換する', () => {
    expect(toAlias('miss-signatures.routes.ts')).toBe('missSignaturesRoute');
  });

  it('通常変換: ネストしたパスの区切りもトークンとして camelCase に含める', () => {
    expect(toAlias('sub/foo-bar.routes.ts')).toBe('subFooBarRoute');
  });
});

describe('toDomainConst', () => {
  it('ハイフン区切りドメインキーを <domain>DomainRoutes 定数名に変換する', () => {
    expect(toDomainConst('self-improvement')).toBe('selfImprovementDomainRoutes');
    expect(toDomainConst('ai')).toBe('aiDomainRoutes');
  });
});

describe('loadLegacyManifest', () => {
  it('正常系: 有効なエントリ配列を返す', () => {
    const manifest = { ai: [{ importPath: './x', exportName: 'xRoutes' }] };

    expect(loadLegacyManifest(manifest, 'ai')).toEqual(manifest.ai);
  });

  it('異常系: ドメインキー欠損で例外をthrowする', () => {
    expect(() => loadLegacyManifest({}, 'ai')).toThrow(/missing domain key/);
  });

  it('異常系: 必須フィールド(exportName)欠損で例外をthrowする', () => {
    const manifest = { ai: [{ importPath: './x' }] };

    expect(() => loadLegacyManifest(manifest, 'ai')).toThrow(/exportName/);
  });

  it('異常系: importPath欠損で例外をthrowする', () => {
    const manifest = { ai: [{ exportName: 'xRoutes' }] };

    expect(() => loadLegacyManifest(manifest, 'ai')).toThrow(/importPath/);
  });
});

describe('generateDomainBarrel', () => {
  it('正常系: legacyエントリのみのドメインを組み立てる', () => {
    const out = generateDomainBarrel(
      'ai',
      [
        { importPath: './ai-chat', exportName: 'aiChatRoutes' },
        { importPath: './prompts', exportName: 'promptsRoutes' },
      ],
      [],
    );

    expect(out).toContain("import { aiChatRoutes } from './ai-chat';");
    expect(out).toContain("export { aiChatRoutes } from './ai-chat';");
    expect(out).toContain('export const aiDomainRoutes = new Elysia()');
    expect(out).toContain('.use(aiChatRoutes)');
    expect(out).toContain('.use(promptsRoutes)');
  });

  it('正常系: 新規discoverファイルのみのドメイン（self-improvement想定）を組み立てる', () => {
    const out = generateDomainBarrel('self-improvement', [], ['miss-signatures.routes.ts']);

    expect(out).toContain("import missSignaturesRoute from './miss-signatures.routes';");
    expect(out).toContain('.use(missSignaturesRoute)');
    expect(out).not.toContain('export {');
  });

  it('混在: legacyエントリ＋discoverファイルの両方を含むドメインを組み立てる', () => {
    const out = generateDomainBarrel(
      'lifestyle',
      [{ importPath: './habits', exportName: 'habitsRoutes' }],
      ['new-feature.routes.ts'],
    );

    const useIndex = out.indexOf('.use(habitsRoutes)');
    const newUseIndex = out.indexOf('.use(newFeatureRoute)');
    expect(useIndex).toBeGreaterThan(-1);
    expect(newUseIndex).toBeGreaterThan(useIndex);
  });

  it('reExportAsあり: export:falseのlegacyエントリはexport{}行を持たずreExportStarのみで公開契約を保つ（agents想定）', () => {
    const out = generateDomainBarrel(
      'agents',
      [
        { importPath: './integrations/approvals', exportName: 'approvalsRoutes', export: false },
        { importPath: './integrations', reExportStar: true },
      ],
      [],
    );

    expect(out).toContain("import { approvalsRoutes } from './integrations/approvals';");
    expect(out).not.toContain('export { approvalsRoutes }');
    expect(out).toContain("export * from './integrations';");
    expect(out).toContain('.use(approvalsRoutes)');
  });

  it('異常系: discoverファイル同士でaliasが衝突する場合は例外をthrowする', () => {
    // 'a-b/foo.routes.ts' と 'a/b-foo.routes.ts' はどちらもトークン ['a','b','foo'] に
    // 分解され、同一alias 'aBFooRoute' を生成する衝突ケース。
    expect(() =>
      generateDomainBarrel('x', [], ['a-b/foo.routes.ts', 'a/b-foo.routes.ts']),
    ).toThrow(/Duplicate route alias/);
  });
});
