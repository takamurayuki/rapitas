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

  // Prune first. This only ever copied files forward, so deleting a schema
  // file from the source left its stale copy here still declaring the models
  // it was meant to remove — and `prisma generate` then fails on relations to
  // models that no longer exist anywhere else.
  const sourceNames = new Set(
    fs
      .readdirSync(sourceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.prisma'))
      .map((e) => e.name),
  );
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;
    if (sourceNames.has(entry.name)) continue;
    fs.unlinkSync(path.join(targetDir, entry.name));
    console.log(`Pruned stale SQLite schema file: ${entry.name}`);
  }

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    let contents = fs.readFileSync(sourcePath, 'utf8');

    if (entry.name === '_generators.prisma') {
      contents = contents
        .replace('Prisma schema for PostgreSQL', 'Prisma schema for SQLite desktop')
        .replace('provider = "postgresql"', 'provider = "sqlite"')
        // Diverge the generated client's output from the postgres source's —
        // otherwise both schemas would generate to the SAME folder and the
        // one generated last would clobber the other (see the NOTE in the
        // source _generators.prisma for why this matters).
        .replace('output = "../../generated/prisma-postgres"', 'output = "../../generated/prisma-sqlite"');
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
