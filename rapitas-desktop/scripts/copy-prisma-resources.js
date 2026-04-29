#!/usr/bin/env node
/**
 * Copy Prisma resources for Tauri build
 * This script copies Prisma schema and migrations to the appropriate locations
 * without using Tauri's bundle.resources which can cause issues
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', '..', 'rapitas-backend', 'prisma');
const targetDir = path.join(__dirname, '..', 'src-tauri', 'resources');

function copyDirectoryContents(source, target) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`Created resources directory: ${targetDir}`);
}

// Copy Prisma schema. The backend uses Prisma's prismaSchemaFolder layout
// (prisma/schema/*.prisma), but older builds copied a single schema.prisma.
// Keep both paths supported so desktop builds don't silently bundle stale schema.
const desktopSchemaDirSource = path.join(srcDir, 'schema.desktop');
const schemaDirSource = fs.existsSync(desktopSchemaDirSource)
  ? desktopSchemaDirSource
  : path.join(srcDir, 'schema');
const schemaDirTarget = path.join(targetDir, 'schema');
const schemaSource = path.join(srcDir, 'schema.prisma');
const schemaTarget = path.join(targetDir, 'schema.prisma');

if (fs.existsSync(schemaDirSource)) {
  copyDirectoryContents(schemaDirSource, schemaDirTarget);
  console.log(`Copied schema directory to resources`);

  if (fs.existsSync(schemaTarget)) {
    try {
      fs.rmSync(schemaTarget, { force: true });
    } catch (error) {
      console.warn(`Warning: could not remove stale schema.prisma: ${error.message}`);
    }
  }
} else if (fs.existsSync(schemaSource)) {
  fs.copyFileSync(schemaSource, schemaTarget);
  console.log(`Copied schema.prisma to resources`);
} else {
  console.warn(`Warning: Prisma schema not found at ${schemaDirSource} or ${schemaSource}`);
}

// Copy migrations directory
const migrationsSource = path.join(srcDir, 'migrations');
const migrationsTarget = path.join(targetDir, 'migrations');

if (fs.existsSync(migrationsSource)) {
  // Remove existing migrations directory if it exists
  if (fs.existsSync(migrationsTarget)) {
    fs.rmSync(migrationsTarget, { recursive: true, force: true });
  }

  // Copy migrations directory recursively
  fs.cpSync(migrationsSource, migrationsTarget, { recursive: true });
  console.log(`Copied migrations directory to resources`);
} else {
  console.warn(`Warning: migrations directory not found at ${migrationsSource}`);
}

console.log('Prisma resources copy complete');
