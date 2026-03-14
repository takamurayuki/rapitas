const fs = require('fs');
const path = require('path');

// Get route file path
const routesDir = path.join(__dirname, 'routes');

// Load and fix TypeScript files
function fixTypeScriptFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // 1. Add t to Elysia import
  if (!content.includes('import { Elysia, t')) {
    content = content.replace(
      /import\s*{\s*Elysia\s*}\s*from\s*["']elysia["'];?/g,
      'import { Elysia, t } from "elysia";'
    );
    modified = true;
  }

  // 2. Remove type annotations
  // Pattern: async ({ params }: { params: { ... } }) =>
  content = content.replace(
    /async\s*\(\s*{\s*([\w\s,]+)\s*}\s*:\s*{[^}]+}\s*\)\s*=>/g,
    'async ({ $1 }) =>'
  );

  // Pattern: async ({ params, body }: { params: { ... }; body: { ... } }) =>
  content = content.replace(
    /async\s*\(\s*{\s*([\w\s,]+)\s*}\s*:\s*{[^}]*}\s*{[^}]*}\s*}\s*\)\s*=>/g,
    'async ({ $1 }) =>'
  );

  // 3. Add schema to route handlers
  // This is complex, so needs to be added manually

  if (content !== fs.readFileSync(filePath, 'utf8')) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
  }
}

// Process all TypeScript files
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