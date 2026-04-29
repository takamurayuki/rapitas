#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const sourceDir = path.join(backendDir, 'prisma', 'schema');
const targetDir = path.join(backendDir, 'prisma', 'schema.desktop');

function copySqliteSchema() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Prisma schema directory not found: ${sourceDir}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    let contents = fs.readFileSync(sourcePath, 'utf8');

    if (entry.name === '_generators.prisma') {
      contents = contents
        .replace('Prisma schema for PostgreSQL', 'Prisma schema for SQLite desktop')
        .replace('provider = "postgresql"', 'provider = "sqlite"');
    }

    contents = contents.replace(/\s+@db\.Decimal\(\d+,\s*\d+\)/g, '');

    fs.writeFileSync(targetPath, contents);
  }
}

try {
  copySqliteSchema();
  console.log(`Generated SQLite Prisma schema: ${targetDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
