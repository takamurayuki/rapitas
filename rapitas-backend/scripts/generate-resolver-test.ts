/**
 * generate-resolver-test
 *
 * CLI that generates a test skeleton for a given resolver source file.
 * Parses exported functions and Prisma calls via regular expressions, then emits
 * a co-located .test.ts file with an embedded coverage checklist.
 * Not responsible for TypeScript compilation — generated output is a human-review skeleton.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, extname, resolve } from 'path';
import { relativeImportPath } from './codemods/lib/codemod-runner';

/** A parsed exported function from a resolver source file. */
export interface ResolverFunction {
  /** Function name. */
  name: string;
  /** True when declared with `async`. */
  isAsync: boolean;
  /** Raw parameter string extracted from source. */
  params: string;
}

/** A detected Prisma model + method call. */
export interface PrismaCall {
  /** Prisma model name (e.g. 'task', 'user'). */
  model: string;
  /** Prisma query method. */
  method: 'findUnique' | 'findFirst' | 'findMany';
}

/**
 * Parse all exported functions from source content.
 * Matches `export [async] function <name>(<params>)` patterns.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Parsed function descriptors / パース済み関数記述子の配列
 */
export function parseResolverFunctions(content: string): ResolverFunction[] {
  const pattern = /export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  const results: ResolverFunction[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    results.push({
      name: match[2],
      isAsync: !!match[1],
      params: match[3].trim(),
    });
  }
  return results;
}

/**
 * Parse unique Prisma model+method pairs from source content.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Deduplicated Prisma call descriptors / 重複排除済みPrisma呼び出し記述子
 */
export function parsePrismaCalls(content: string): PrismaCall[] {
  const pattern = /prisma\.(\w+)\.(findUnique|findFirst|findMany)/g;
  const seen = new Set<string>();
  const results: PrismaCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const key = `${match[1]}.${match[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ model: match[1], method: match[2] as PrismaCall['method'] });
    }
  }
  return results;
}

/**
 * Extract import paths that are not Prisma/database/logger modules.
 * Callers that need manual mock.module entries are listed here.
 *
 * @param content - Source file content / ソースファイル内容
 * @returns Non-Prisma import paths / 非Prismaインポートパスのリスト
 */
export function extractNonPrismaImports(content: string): string[] {
  const pattern = /^import\s+.*\s+from\s+['"]([^'"]+)['"]/gm;
  const excluded = new Set(['@prisma/client', '../../config/database', '../../config/logger']);
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const p = match[1];
    if (!excluded.has(p) && !p.includes('@prisma')) {
      results.push(p);
    }
  }
  return results;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toMockVarName(model: string, method: string): string {
  return `mock${capitalize(model)}${capitalize(method)}`;
}

/**
 * Build the mock declaration block for Prisma calls and the noop logger.
 *
 * @param prismaCalls - Prisma call descriptors / Prisma呼び出し記述子
 * @param nonPrismaImports - Non-Prisma imports needing manual mocking / 手動モックが必要なインポート
 * @returns Mock block string / モックブロック文字列
 */
export function buildMockBlock(prismaCalls: PrismaCall[], nonPrismaImports: string[]): string {
  const lines: string[] = [];

  lines.push('// HACK(agent): bun:test の mock.module はプロセスグローバルなため、');
  lines.push('// 全エクスポートをミラーしないとバレルが "export not found" をスローする。');

  // Deduplicate by model for grouping in mock.module
  const byModel = new Map<string, string[]>();
  for (const call of prismaCalls) {
    const list = byModel.get(call.model) ?? [];
    list.push(call.method);
    byModel.set(call.model, list);
  }

  // One const per (model, method) pair
  for (const call of prismaCalls) {
    const varName = toMockVarName(call.model, call.method);
    lines.push(`const ${varName} = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;`);
  }

  if (prismaCalls.length > 0) {
    lines.push('');
    lines.push("mock.module('../../config/database', () => ({");
    lines.push('  prisma: {');
    const modelLines: string[] = [];
    for (const [model, methods] of byModel) {
      const methodParts = methods.map((m) => `${m}: ${toMockVarName(model, m)}`).join(', ');
      modelLines.push(`    ${model}: { ${methodParts} }`);
    }
    lines.push(modelLines.join(',\n'));
    lines.push('  },');
    lines.push('  ensureDatabaseConnection: () => Promise.resolve(),');
    lines.push('}));');
  }

  lines.push('');
  lines.push("mock.module('../../config/logger', () => {");
  lines.push('  const noopLogger = {');
  lines.push('    info: () => {},');
  lines.push('    error: () => {},');
  lines.push('    warn: () => {},');
  lines.push('    debug: () => {},');
  lines.push('    fatal: () => {},');
  lines.push('  };');
  lines.push('  return {');
  lines.push('    createLogger: () => noopLogger,');
  lines.push('    logger: noopLogger,');
  lines.push("    getBackendLogFilePath: () => '/tmp/backend.log',");
  lines.push('  };');
  lines.push('});');

  if (nonPrismaImports.length > 0) {
    lines.push('');
    for (const imp of nonPrismaImports) {
      lines.push(
        `// TODO(human): mock '${imp}' — add mock.module call for this non-Prisma dependency`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Build test cases for a single resolver function.
 * Async functions get 4 cases (①②③④); sync functions get 3 (①②④).
 *
 * @param fn - Resolver function metadata / resolver関数メタデータ
 * @param prismaCalls - Prisma calls for mock variable reference / モック変数参照用Prisma呼び出し
 * @returns Test case block string / テストケースブロック文字列
 */
export function buildTestCases(fn: ResolverFunction, prismaCalls: PrismaCall[]): string {
  const lines: string[] = [];

  // NOTE: Only async functions reference Prisma mocks — sync resolvers don't use Prisma directly.
  const primaryCall = fn.isAsync ? (prismaCalls[0] ?? null) : null;
  const varName = primaryCall ? toMockVarName(primaryCall.model, primaryCall.method) : null;

  const paramCount = fn.params ? fn.params.split(',').length : 0;
  const placeholder = Array.from({ length: paramCount }, () => '/* TODO(human): add param */').join(
    ', ',
  );
  const callExpr = fn.isAsync ? `await ${fn.name}(${placeholder})` : `${fn.name}(${placeholder})`;
  const testAsync = fn.isAsync ? 'async ' : '';

  // ① 正常系
  lines.push(
    `  test('${fn.name}: エンティティが存在する場合 → 結果を返すこと', ${testAsync}() => {`,
  );
  if (varName) {
    lines.push(`    const fakeResult = { id: 1 }; // TODO(human): fill with realistic fixture`);
    lines.push(`    ${varName}.mockResolvedValueOnce(fakeResult);`);
  }
  lines.push(`    const result = ${callExpr};`);
  lines.push(`    expect(result).${varName ? 'toEqual(fakeResult)' : 'toBeDefined()'};`);
  lines.push(`  });`);
  lines.push('');

  // ② 未発見系
  lines.push(
    `  test('${fn.name}: エンティティが存在しない場合 → null を返すこと', ${testAsync}() => {`,
  );
  if (varName) {
    lines.push(`    ${varName}.mockResolvedValueOnce(null);`);
  }
  lines.push(`    const result = ${callExpr};`);
  lines.push(`    expect(result).${varName ? 'toBeNull()' : 'toBeFalsy()'};`);
  lines.push(`  });`);
  lines.push('');

  // ③ DBエラー系 (async のみ)
  if (fn.isAsync && varName) {
    lines.push(`  test('${fn.name}: DB エラー時 → null を返すこと', async () => {`);
    lines.push(`    ${varName}.mockRejectedValueOnce(new Error('DB error'));`);
    lines.push(`    const result = ${callExpr};`);
    lines.push(`    expect(result).toBeNull();`);
    lines.push(`  });`);
    lines.push('');
  }

  // ④ クエリ引数検証
  lines.push(`  test('${fn.name}: クエリ引数が正しく渡されること', ${testAsync}() => {`);
  lines.push(`    ${callExpr};`);
  if (varName) {
    lines.push(`    expect(${varName}).toHaveBeenCalledTimes(1);`);
    lines.push(
      `    const callArgs = ${varName}.mock.calls[0][0] as { where: Record<string, unknown> };`,
    );
    lines.push(
      `    expect(callArgs.where).toBeDefined(); // TODO(human): assert specific where clause`,
    );
  } else {
    lines.push(`    // TODO(human): assert function was called with correct arguments`);
  }
  lines.push(`  });`);

  return lines.join('\n');
}

/**
 * Build the complete test file content from parsed resolver metadata.
 *
 * @param resolverFile - Absolute path to the resolver source / resolverソースの絶対パス
 * @param functions - Parsed exported functions / パース済みエクスポート関数
 * @param prismaCalls - Detected Prisma calls / 検出されたPrisma呼び出し
 * @param nonPrismaImports - Non-Prisma imports / 非Prismaインポート
 * @param testFile - Absolute path for the output test file / 出力テストファイルの絶対パス
 * @returns Complete test file content / テストファイルの完全な内容
 */
export function buildTestFile(
  resolverFile: string,
  functions: ResolverFunction[],
  prismaCalls: PrismaCall[],
  nonPrismaImports: string[],
  testFile: string,
): string {
  const resolverName = basename(resolverFile, extname(resolverFile));
  const importPath = relativeImportPath(testFile, resolverFile.replace(/\.ts$/, ''));
  const fnNames = functions.map((f) => f.name).join(', ');

  const byModel = new Map<string, string[]>();
  for (const call of prismaCalls) {
    const list = byModel.get(call.model) ?? [];
    list.push(call.method);
    byModel.set(call.model, list);
  }

  const nonPrismaBlock =
    nonPrismaImports.length > 0
      ? ` *\n * 非Prisma依存 (手動モック追加が必要):\n${nonPrismaImports.map((i) => ` *   - '${i}'`).join('\n')}\n`
      : '';

  const header = `/**
 * ${resolverName} ユニットテスト (自動生成スケルトン)
 *
 * ────────────────────────────────────────────────────────
 * 網羅チェックリスト (TODO(human): 補完後にチェックを入れること)
 * ────────────────────────────────────────────────────────
 * テストケース種別:
 *   ① 正常系   — エンティティが存在する → 結果を返すこと
 *   ② 未発見系 — findX が null を返す → null/falsy を返すこと
 *   ③ DBエラー系 — findX が reject → null を返すこと (async のみ)
 *   ④ クエリ引数 — where / select / include が正しく渡されること
 *
 * 手動補完が必要な箇所: TODO(human) コメントを検索すること
 *   - 各テストの引数プレースホルダを実際の値に置き換える
 *   - フィクスチャに現実的なフィールドを追加する
 *   - select / include の構造をソースの実装と照合する
 *   - 非Prisma依存モジュールの mock.module を追加する
${nonPrismaBlock} */
import { describe, test, expect, mock, beforeEach } from 'bun:test';`;

  const parts: string[] = [header];

  parts.push('');
  parts.push(buildMockBlock(prismaCalls, nonPrismaImports));
  parts.push('');
  parts.push(`const { ${fnNames} } = await import('${importPath}');`);

  if (prismaCalls.length > 0) {
    const resetLines: string[] = [];
    for (const [model, methods] of byModel) {
      for (const method of methods) {
        const varName = toMockVarName(model, method);
        resetLines.push(`  ${varName}.mockReset();`);
        resetLines.push(`  ${varName}.mockResolvedValue(null);`);
      }
    }
    parts.push('');
    parts.push(`beforeEach(() => {\n${resetLines.join('\n')}\n});`);
  }

  for (const fn of functions) {
    parts.push('');
    parts.push(
      [
        '// ---------------------------------------------------------------------------',
        `// ${fn.name}`,
        '// ---------------------------------------------------------------------------',
      ].join('\n'),
    );
    parts.push(`describe('${fn.name}', () => {`);
    parts.push(buildTestCases(fn, prismaCalls));
    parts.push('});');
  }

  parts.push('');
  return parts.join('\n');
}

/**
 * Check whether writing to the output path is allowed.
 *
 * @param outputPath - Target file path / 出力ファイルパス
 * @param force - Whether to overwrite existing files / 上書きを強制するか
 * @returns true when writing is allowed / 書き込み可能なら true
 */
export function checkWriteAllowed(outputPath: string, force: boolean): boolean {
  return !existsSync(outputPath) || force;
}

function printUsage(): void {
  console.log('Usage: bun run generate:resolver-test <resolver-file> [--force]');
  console.log('');
  console.log('  <resolver-file>  Path to the resolver .ts source file');
  console.log('  --force          Overwrite existing test file');
  console.log('');
  console.log('Example:');
  console.log('  bun run generate:resolver-test services/core/user-resolver.ts');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filePaths = args.filter((a) => !a.startsWith('--'));

  if (filePaths.length === 0) {
    printUsage();
    process.exit(1);
  }

  const inputRaw = filePaths[0];
  const inputPath = resolve(inputRaw);

  if (!existsSync(inputPath)) {
    console.error(`エラー: ファイルが見つかりません: ${inputRaw}`);
    printUsage();
    process.exit(1);
  }

  const content = readFileSync(inputPath, 'utf-8');
  const functions = parseResolverFunctions(content);
  const prismaCalls = parsePrismaCalls(content);
  const nonPrismaImports = extractNonPrismaImports(content);

  if (functions.length === 0) {
    console.error(`生成対象なし: ${inputRaw} に export 関数が見つかりませんでした。`);
    process.exit(1);
  }

  const dir = dirname(inputPath);
  const baseName = basename(inputPath, extname(inputPath));
  const outputPath = resolve(dir, `${baseName}.test.ts`);

  if (!checkWriteAllowed(outputPath, force)) {
    console.error(
      `エラー: ${outputPath} は既に存在します。上書きするには --force を指定してください。`,
    );
    process.exit(1);
  }

  const fileContent = buildTestFile(
    inputPath,
    functions,
    prismaCalls,
    nonPrismaImports,
    outputPath,
  );
  writeFileSync(outputPath, fileContent, 'utf-8');
  console.log(`✓ 生成完了: ${outputPath}`);
}

// NOTE: Guard prevents main() from running when this module is imported by tests.
if (import.meta.main) {
  main();
}
