#!/usr/bin/env node
/**
 * Web開発用にPostgreSQLスキーマに切り替え
 */
const { execSync } = require('child_process');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../rapitas-backend');

console.log('Preparing for Web development (PostgreSQL)...');

// 既存のバックエンドプロセスを停止
console.log('Stopping existing backend processes...');
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM bun.exe 2>nul', { shell: true, stdio: 'ignore' });
    execSync('taskkill /F /IM rapitas-backend.exe 2>nul', { shell: true, stdio: 'ignore' });
    execSync('ping -n 2 127.0.0.1 >nul', { shell: true, stdio: 'ignore' });
  } else {
    execSync('pkill -f "bun.*index.ts" || true', { shell: true, stdio: 'ignore' });
  }
} catch (e) { /* ignore */ }

// PostgreSQLスキーマに切り替え
console.log('Switching to PostgreSQL schema...');
try {
  execSync('node scripts/switch-schema.cjs postgres', { cwd: BACKEND_DIR, stdio: 'inherit' });
  execSync('bun run db:generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
  console.log('Ready for Web development!');
} catch (err) {
  console.error('Failed to switch schema:', err.message);
  process.exit(1);
}
