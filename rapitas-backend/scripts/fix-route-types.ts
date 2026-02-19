import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

async function fixRouteTypes() {
  const routesDir = join(process.cwd(), 'routes');
  const files = await readdir(routesDir);

  for (const file of files) {
    if (!file.endsWith('.ts')) continue;

    const filePath = join(routesDir, file);
    let content = await readFile(filePath, 'utf-8');

    // パターン1: async ({ params }: { params: { ... } }) => を async ({ params }) => に変換
    // 複数行にまたがる場合も考慮
    content = content.replace(
      /async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}\s*\)\s*=>/g,
      'async ({ $1 }) =>'
    );

    // パターン2: より複雑な複数パラメータのケース
    // async ({ params, body, query, set }: { params: ..., body: ... }) =>
    content = content.replace(
      /async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}[^)]*\)\s*=>/gs,
      'async ({ $1 }) =>'
    );

    // パターン3: function形式のハンドラー
    content = content.replace(
      /function\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}\s*\)/g,
      'function({ $1 })'
    );

    await writeFile(filePath, content, 'utf-8');
    console.log(`Fixed ${file}`);
  }

  // index.tsとstub-index.tsも修正
  const additionalFiles = ['index.ts', 'stub-index.ts'];
  for (const file of additionalFiles) {
    const filePath = join(process.cwd(), file);
    try {
      let content = await readFile(filePath, 'utf-8');

      content = content.replace(
        /async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]+\}\s*\)\s*=>/g,
        'async ({ $1 }) =>'
      );

      content = content.replace(
        /async\s*\(\s*\{\s*([^}]+)\s*\}\s*:\s*\{[^}]*\}[^)]*\)\s*=>/gs,
        'async ({ $1 }) =>'
      );

      await writeFile(filePath, content, 'utf-8');
      console.log(`Fixed ${file}`);
    } catch (e) {
      // ファイルが存在しない場合はスキップ
    }
  }
}

fixRouteTypes().catch(console.error);