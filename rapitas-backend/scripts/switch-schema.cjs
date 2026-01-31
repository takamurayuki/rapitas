#!/usr/bin/env node
/**
 * Prisma スキーマ切り替えスクリプト
 * SQLite（Tauri用）とPostgreSQL（Web用）を切り替える
 */
const fs = require('fs');
const path = require('path');

const PRISMA_DIR = path.join(__dirname, '../prisma');
const SCHEMA_PATH = path.join(PRISMA_DIR, 'schema.prisma');
const POSTGRES_SCHEMA = path.join(PRISMA_DIR, 'schema.postgres.backup.prisma');
const SQLITE_SCHEMA = path.join(PRISMA_DIR, 'schema.sqlite.prisma');

const mode = process.argv[2];

if (!mode || !['postgres', 'sqlite', 'status'].includes(mode)) {
  console.log('Usage: node switch-schema.js [postgres|sqlite|status]');
  process.exit(1);
}

// 現在のスキーマを確認
function getCurrentProvider() {
  if (!fs.existsSync(SCHEMA_PATH)) {
    return 'unknown';
  }
  const content = fs.readFileSync(SCHEMA_PATH, 'utf8');
  if (content.includes('provider = "postgresql"')) {
    return 'postgresql';
  } else if (content.includes('provider = "sqlite"')) {
    return 'sqlite';
  }
  return 'unknown';
}

if (mode === 'status') {
  const current = getCurrentProvider();
  console.log(`Current schema provider: ${current}`);
  process.exit(0);
}

// 現在のスキーマをバックアップ
function backupCurrentSchema() {
  const current = getCurrentProvider();
  if (current === 'postgresql') {
    fs.copyFileSync(SCHEMA_PATH, POSTGRES_SCHEMA);
    console.log('  Backed up current PostgreSQL schema');
  } else if (current === 'sqlite') {
    fs.copyFileSync(SCHEMA_PATH, SQLITE_SCHEMA);
    console.log('  Backed up current SQLite schema');
  }
}

// スキーマを切り替え
if (mode === 'postgres') {
  console.log('Switching to PostgreSQL schema...');

  if (getCurrentProvider() === 'postgresql') {
    console.log('  Already using PostgreSQL schema');
    process.exit(0);
  }

  // 現在のスキーマをバックアップ
  backupCurrentSchema();

  // PostgreSQLスキーマをコピー
  if (fs.existsSync(POSTGRES_SCHEMA)) {
    fs.copyFileSync(POSTGRES_SCHEMA, SCHEMA_PATH);
    console.log('  Switched to PostgreSQL schema');
  } else {
    console.error('  Error: PostgreSQL schema backup not found');
    process.exit(1);
  }
} else if (mode === 'sqlite') {
  console.log('Switching to SQLite schema...');

  if (getCurrentProvider() === 'sqlite') {
    console.log('  Already using SQLite schema');
    process.exit(0);
  }

  // 現在のスキーマをバックアップ
  backupCurrentSchema();

  // SQLiteスキーマをコピー
  if (fs.existsSync(SQLITE_SCHEMA)) {
    fs.copyFileSync(SQLITE_SCHEMA, SCHEMA_PATH);
    console.log('  Switched to SQLite schema');
  } else {
    console.error('  Error: SQLite schema backup not found');
    process.exit(1);
  }
}

console.log('Done!');
console.log('');
console.log('Next steps:');
console.log('  1. Run: bun run db:generate');
console.log('  2. Run: bun run dev:simple');
