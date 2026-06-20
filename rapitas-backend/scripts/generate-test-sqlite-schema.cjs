#!/usr/bin/env node
/**
 * generate-test-sqlite-schema.cjs
 *
 * Reads prisma/schema.desktop/ and copies it to prisma/schema.test-sqlite/,
 * injecting `output = "../../src/generated/prisma-sqlite"` into the generator
 * block so that `prisma generate --schema prisma/schema.test-sqlite` emits the
 * SQLite client into a dedicated directory without touching the default
 * @prisma/client (PostgreSQL) used by the running :3001 server.
 *
 * This script is idempotent: re-running it overwrites the target directory.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const backendDir = path.resolve(__dirname, '..');
const sourceDir = path.join(backendDir, 'prisma', 'schema.desktop');
const targetDir = path.join(backendDir, 'prisma', 'schema.test-sqlite');

/** @param {string} generatorsContent */
function injectOutput(generatorsContent) {
  // Replace the generator client block to add a custom output path.
  // NOTE: The output path is relative to the schema directory (prisma/schema.test-sqlite/).
  // Two levels up reaches rapitas-backend/, then we target src/generated/prisma-sqlite.
  return generatorsContent.replace(/generator client \{([^}]*)\}/s, (_, inner) => {
    // Remove any existing output line to stay idempotent.
    const cleaned = inner.replace(/\n?\s*output\s*=\s*"[^"]*"/g, '');
    return `generator client {${cleaned}\n  output = "../../src/generated/prisma-sqlite"\n}`;
  });
}

function generateTestSqliteSchema() {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(
      `Source schema directory not found: ${sourceDir}\n` +
        'Run "bun run db:generate:sqlite" first to generate prisma/schema.desktop.',
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.prisma')) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    let contents = fs.readFileSync(sourcePath, 'utf8');

    if (entry.name === '_generators.prisma') {
      contents = injectOutput(contents);
    }

    fs.writeFileSync(targetPath, contents);
  }
}

try {
  generateTestSqliteSchema();
  console.log(`Generated test SQLite schema: ${targetDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
