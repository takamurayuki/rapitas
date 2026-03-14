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

// Ensure target directory exists
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`Created resources directory: ${targetDir}`);
}

// Copy schema.prisma
const schemaSource = path.join(srcDir, 'schema.prisma');
const schemaTarget = path.join(targetDir, 'schema.prisma');

if (fs.existsSync(schemaSource)) {
  fs.copyFileSync(schemaSource, schemaTarget);
  console.log(`Copied schema.prisma to resources`);
} else {
  console.warn(`Warning: schema.prisma not found at ${schemaSource}`);
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