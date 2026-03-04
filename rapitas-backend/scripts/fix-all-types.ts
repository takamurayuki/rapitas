import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function fixFile(filePath: string) {
  let content = await readFile(filePath, 'utf-8');
  let modified = false;
  const originalContent = content;

  // パターン1: シンプルなパラメータ（params, body, query, set, request単体）
  // 例: async ({ params }: { params: { id: string } }) =>
  const simplePattern = /async\s*\(\s*\{\s*(\w+)\s*\}\s*:\s*\{\s*\w+\s*:\s*[^}]+\}\s*\)\s*=>/g;
  if (simplePattern.test(content)) {
    content = content.replace(simplePattern, 'async ({ $1 }) =>');
    modified = true;
  }

  // パターン2: 複数行にまたがるシンプルなケース
  // 例: async ({ \n params }: { params: { id: string } }) =>
  const multilineSimplePattern = /async\s*\(\s*\{\s*\n?\s*(\w+)\s*\}\s*:\s*\{[^}]+\}\s*\)\s*=>/gs;
  if (multilineSimplePattern.test(content)) {
    content = content.replace(multilineSimplePattern, 'async ({ $1 }) =>');
    modified = true;
  }

  // パターン3: 複数のパラメータ
  // 例: async ({ params, body }: { params: {...}, body: {...} }) =>
  const multiParamPattern = /async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}(?:[^}]*\})*[^)]*\)\s*=>/gs;
  if (multiParamPattern.test(content)) {
    content = content.replace(multiParamPattern, (match, params) => {
      // パラメータ名だけを抽出
      const cleanParams = params.replace(/[\s\n]+/g, ' ').trim();
      return `async ({ ${cleanParams} }) =>`;
    });
    modified = true;
  }

  // パターン4: 関数宣言形式
  // 例: function({ params }: { params: {...} })
  const functionPattern = /function\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}\s*\)/g;
  if (functionPattern.test(content)) {
    content = content.replace(functionPattern, 'function({ $1 })');
    modified = true;
  }

  // HTTPHeaders型エラーの修正
  // 'HTTPHeaders' を 'Record<string, string>' に置換
  if (content.includes('set.headers: HTTPHeaders')) {
    content = content.replace(/set\.headers:\s*HTTPHeaders/g, 'set.headers: Record<string, string>');
    modified = true;
  }

  // HeadersInit型エラーの修正
  if (content.includes('HeadersInit')) {
    content = content.replace(/:\s*HeadersInit/g, ': Record<string, string>');
    modified = true;
  }

  if (modified && content !== originalContent) {
    await writeFile(filePath, content, 'utf-8');
    return true;
  }
  return false;
}

async function fixAllFiles() {
  let totalFixed = 0;

  // routes ディレクトリの処理
  const routesDir = join(process.cwd(), 'routes');
  try {
    const files = await readdir(routesDir);
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const filePath = join(routesDir, file);
      if (await fixFile(filePath)) {
        console.log(`✓ Fixed ${file}`);
        totalFixed++;
      }
    }
  } catch (error) {
    console.error('Error processing routes directory:', error);
  }

  // ルートディレクトリのファイル
  const rootFiles = ['index.ts', 'stub-index.ts', 'index-optimized.ts'];
  for (const file of rootFiles) {
    const filePath = join(process.cwd(), file);
    try {
      if (await fixFile(filePath)) {
        console.log(`✓ Fixed ${file}`);
        totalFixed++;
      }
    } catch (e) {
      // ファイルが存在しない場合はスキップ
    }
  }

  // services ディレクトリの処理
  const servicesDir = join(process.cwd(), 'services');
  try {
    const files = await readdir(servicesDir);
    for (const file of files) {
      if (!file.endsWith('.ts')) continue;
      const filePath = join(servicesDir, file);
      if (await fixFile(filePath)) {
        console.log(`✓ Fixed services/${file}`);
        totalFixed++;
      }
    }
  } catch (error) {
    // ディレクトリが存在しない場合はスキップ
  }

  console.log(`\nTotal files fixed: ${totalFixed}`);
}

// より複雑なケースを処理するための追加関数
async function fixComplexPatterns() {
  const complexFiles = [
    'routes/ai-agent.ts',
    'routes/approvals.ts',
    'routes/developer-mode.ts',
    'routes/parallel-execution.ts',
    'routes/tasks.ts'
  ];

  for (const file of complexFiles) {
    const filePath = join(process.cwd(), file);
    try {
      let content = await readFile(filePath, 'utf-8');

      // 非常に複雑なパターン（複数行、複数パラメータ）
      // 改行を含む型定義を除去
      content = content.replace(
        /async\s*\(\s*\{([^}]+)\}\s*:\s*\{[\s\S]*?\}\s*\)\s*=>/g,
        (match, params) => {
          // パラメータリストを整理
          const cleanedParams = params
            .split(',')
            .map(p => p.trim())
            .filter(p => p && !p.includes(':'))
            .join(', ');
          return `async ({ ${cleanedParams} }) =>`;
        }
      );

      await writeFile(filePath, content, 'utf-8');
      console.log(`✓ Fixed complex patterns in ${file}`);
    } catch (e) {
      // エラーは無視
    }
  }
}

async function main() {
  console.log('Starting type fixes...\n');
  await fixAllFiles();
  await fixComplexPatterns();
  console.log('\nType fixes completed!');
}

main().catch(console.error);