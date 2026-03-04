const fs = require('fs');
const path = require('path');

// ルートファイルのパスを取得
const routesDir = path.join(__dirname, 'routes');

// TypeScriptファイルを読み込んで修正
function fixTypeScriptFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Elysiaインポートにtを追加
  if (!content.includes('import { Elysia, t')) {
    content = content.replace(
      /import\s*{\s*Elysia\s*}\s*from\s*["']elysia["'];?/g,
      'import { Elysia, t } from "elysia";'
    );
    modified = true;
  }

  // 2. 型注釈を削除する
  // パターン: async ({ params }: { params: { ... } }) =>
  content = content.replace(
    /async\s*\(\s*{\s*([\w\s,]+)\s*}\s*:\s*{[^}]+}\s*\)\s*=>/g,
    'async ({ $1 }) =>'
  );

  // パターン: async ({ params, body }: { params: { ... }; body: { ... } }) =>
  content = content.replace(
    /async\s*\(\s*{\s*([\w\s,]+)\s*}\s*:\s*{[^}]*}\s*{[^}]*}\s*}\s*\)\s*=>/g,
    'async ({ $1 }) =>'
  );

  // 3. ルートハンドラーにスキーマを追加
  // これは複雑なので、手動で追加する必要がある

  if (content !== fs.readFileSync(filePath, 'utf8')) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
  }
}

// すべてのTypeScriptファイルを処理
fs.readdirSync(routesDir).forEach(file => {
  if (file.endsWith('.ts')) {
    const filePath = path.join(routesDir, file);
    try {
      fixTypeScriptFile(filePath);
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
});