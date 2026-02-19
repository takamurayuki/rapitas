import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function safeFixFile(filePath: string) {
  try {
    let content = await readFile(filePath, 'utf-8');
    const originalContent = content;
    let modified = false;

    // より安全な修正パターン

    // パターン1: シンプルなケース（1行）
    // async ({ params }: { params: { id: string } }) =>
    content = content.replace(
      /async\s+\(\s*\{\s*(\w+)\s*\}\s*:\s*\{\s*\w+\s*:[^}]+\}\s*\)\s*=>/g,
      'async ({ $1 }) =>'
    );

    // パターン2: 複数パラメータ（1行）
    // async ({ params, body }: { params: ..., body: ... }) =>
    content = content.replace(
      /async\s+\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}(?:\s*,\s*[^}]+\})*\s*\)\s*=>/g,
      (match, params) => {
        const cleanParams = params.split(',').map((p: string) => p.trim().split(':')[0].trim()).join(', ');
        return `async ({ ${cleanParams} }) =>`;
      }
    );

    // パターン3: 改行を含むケース - より慎重に
    // まず、問題のあるパターンを見つける
    const multilinePattern = /async\s*\(\s*\{\s*\n?\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}\s*\)\s*=>/;
    const match = content.match(multilinePattern);
    if (match) {
      // パラメータ名だけを抽出
      const params = match[1].split(',').map(p => p.trim().split(':')[0].trim()).filter(p => p);
      const replacement = `async ({ ${params.join(', ')} }) =>`;
      content = content.replace(multilinePattern, replacement);
      modified = true;
    }

    // パターン4: GET/POST/PUT/DELETE メソッドの引数
    // .get("/:id", async ({ params }: { params: { id: string } }) =>
    const routeMethodPattern = /\.(get|post|put|delete|patch)\s*\(\s*["'][^"']+["']\s*,\s*async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}[^)]*\)\s*=>/g;
    if (routeMethodPattern.test(content)) {
      content = content.replace(routeMethodPattern, (match, method, params) => {
        const cleanParams = params.split(',').map((p: string) => p.trim().split(':')[0].trim()).filter((p: string) => p);
        return `.${method}(${match.split(',')[0].split('(')[1]}, async ({ ${cleanParams.join(', ')} }) =>`;
      });
      modified = true;
    }

    // 安全性チェック: 変更後のコードが有効なJavaScriptかどうか簡易チェック
    try {
      // 基本的な括弧のバランスをチェック
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;

      if (openBraces !== closeBraces || openParens !== closeParens) {
        console.error(`❌ Bracket mismatch in ${filePath}, reverting changes`);
        return false;
      }
    } catch (e) {
      console.error(`❌ Error checking ${filePath}, reverting changes`);
      return false;
    }

    if (content !== originalContent) {
      await writeFile(filePath, content, 'utf-8');
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return false;
  }
}

async function fixAllFilesSafely() {
  const results = {
    success: 0,
    failed: 0,
    skipped: 0
  };

  // routes ディレクトリの処理
  const routesDir = join(process.cwd(), 'routes');
  try {
    const files = await readdir(routesDir);

    // 問題のあったファイルを優先的に処理
    const problemFiles = [
      'ai-chat.ts',
      'approvals.ts',
      'categories.ts',
      'flashcards.ts',
      'parallel-execution.ts',
      'prompts.ts',
      'task-dependency.ts',
      'tasks.ts',
      'templates.ts'
    ];

    // 問題のあったファイルから処理
    for (const file of problemFiles) {
      if (!files.includes(file)) continue;
      const filePath = join(routesDir, file);
      console.log(`Processing ${file}...`);
      if (await safeFixFile(filePath)) {
        console.log(`✓ Successfully fixed ${file}`);
        results.success++;
      } else {
        console.log(`⚠ Skipped ${file} (no changes or error)`);
        results.skipped++;
      }
    }

    // その他のファイルを処理
    for (const file of files) {
      if (!file.endsWith('.ts') || problemFiles.includes(file)) continue;
      const filePath = join(routesDir, file);
      if (await safeFixFile(filePath)) {
        console.log(`✓ Fixed ${file}`);
        results.success++;
      } else {
        results.skipped++;
      }
    }
  } catch (error) {
    console.error('Error processing routes directory:', error);
  }

  console.log(`\nResults:`);
  console.log(`✓ Successfully fixed: ${results.success} files`);
  console.log(`⚠ Skipped: ${results.skipped} files`);
  console.log(`❌ Failed: ${results.failed} files`);
}

// 特定のファイルだけを修正する関数
async function fixSpecificFile(fileName: string) {
  const filePath = join(process.cwd(), 'routes', fileName);
  console.log(`\nFixing ${fileName}...`);

  const content = await readFile(filePath, 'utf-8');
  console.log('\nBefore fix (first 500 chars):');
  console.log(content.substring(0, 500));

  if (await safeFixFile(filePath)) {
    console.log(`\n✓ Successfully fixed ${fileName}`);
    const newContent = await readFile(filePath, 'utf-8');
    console.log('\nAfter fix (first 500 chars):');
    console.log(newContent.substring(0, 500));
  } else {
    console.log(`\n❌ Failed to fix ${fileName}`);
  }
}

// メイン処理
async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0] === '--file' && args[1]) {
    // 特定のファイルだけを修正
    await fixSpecificFile(args[1]);
  } else {
    // すべてのファイルを修正
    console.log('Starting safe type fixes...\n');
    await fixAllFilesSafely();
  }
}

main().catch(console.error);