#!/usr/bin/env node
/**
 * 開発モード用スクリプト
 * フロントエンドとバックエンドを並行して起動
 */
const { spawn, execSync } = require('child_process');
const path = require('path');

const FRONTEND_DIR = path.resolve(__dirname, '../../rapitas-frontend');
const BACKEND_DIR = path.resolve(__dirname, '../../rapitas-backend');

console.log('Starting development servers for Tauri (SQLite mode)...');

// 既存のバックエンドプロセスを停止（ファイルロック解除のため）
console.log('Stopping existing backend processes...');
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM bun.exe 2>nul', { shell: true, stdio: 'ignore' });
    execSync('taskkill /F /IM rapitas-backend.exe 2>nul', { shell: true, stdio: 'ignore' });
  } else {
    execSync('pkill -f "bun.*index.ts" || true', { shell: true, stdio: 'ignore' });
  }
  // 少し待機してファイルロックが解除されるのを待つ
  execSync('ping -n 2 127.0.0.1 >nul', { shell: true, stdio: 'ignore' });
} catch (err) {
  // プロセスが存在しない場合は無視
}

// SQLiteスキーマに切り替え
console.log('Switching to SQLite schema...');
try {
  execSync('node scripts/switch-schema.cjs sqlite', { cwd: BACKEND_DIR, stdio: 'inherit' });
  execSync('bun run db:generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
} catch (err) {
  console.error('Failed to switch schema:', err.message);
  process.exit(1);
}

// バックエンドを起動 (SQLiteモード)
const backend = spawn('bun', ['run', 'dev:simple'], {
  cwd: BACKEND_DIR,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    TAURI_BUILD: 'true',
    RAPITAS_SQLITE: 'true'
  }
});

// フロントエンドを起動
const frontend = spawn('pnpm', ['run', 'dev'], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true
});

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\nStopping development servers...');
  backend.kill();
  frontend.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});

// 子プロセスのエラーハンドリング
backend.on('error', (err) => {
  console.error('Backend error:', err);
});

frontend.on('error', (err) => {
  console.error('Frontend error:', err);
});
