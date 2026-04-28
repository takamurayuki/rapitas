#!/usr/bin/env node
/**
 * dev-with-cache-check.js
 *
 * Automatically clears .next cache when package.json or pnpm-lock.yaml changes.
 * Prevents stale dependency issues after upgrades.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, '.next');
const TURBO_CACHE = path.join(ROOT, 'node_modules', '.cache');
const LOCK_FILE = path.join(ROOT, 'pnpm-lock.yaml');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const HASH_FILE = path.join(ROOT, 'node_modules', '.cache', '.deps-hash');

/**
 * Calculate hash of dependency files
 */
function calculateDepsHash() {
  const lockContent = fs.existsSync(LOCK_FILE)
    ? fs.readFileSync(LOCK_FILE, 'utf8')
    : '';
  const pkgContent = fs.existsSync(PACKAGE_JSON)
    ? fs.readFileSync(PACKAGE_JSON, 'utf8')
    : '';

  return crypto
    .createHash('sha256')
    .update(lockContent + pkgContent)
    .digest('hex');
}

/**
 * Get stored hash from previous run
 */
function getStoredHash() {
  try {
    if (fs.existsSync(HASH_FILE)) {
      return fs.readFileSync(HASH_FILE, 'utf8').trim();
    }
  } catch (err) {
    // Ignore errors
  }
  return null;
}

/**
 * Store current hash
 */
function storeHash(hash) {
  const cacheDir = path.dirname(HASH_FILE);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(HASH_FILE, hash, 'utf8');
}

/**
 * Clear .next and Turbopack cache
 */
function clearNextCache() {
  let cleared = false;

  // Clear .next directory
  if (fs.existsSync(CACHE_DIR)) {
    console.log('🧹 Clearing .next cache...');
    try {
      fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      cleared = true;
    } catch (err) {
      console.warn('⚠ Failed to clear .next cache:', err.message);
    }
  }

  // Clear Turbopack cache
  if (fs.existsSync(TURBO_CACHE)) {
    console.log('🧹 Clearing Turbopack cache...');
    try {
      // Clear only Turbopack/Next.js related caches, preserve deps-hash
      const hashFileBackup = fs.existsSync(HASH_FILE)
        ? fs.readFileSync(HASH_FILE, 'utf8')
        : null;

      fs.rmSync(TURBO_CACHE, { recursive: true, force: true });

      // Restore hash file
      if (hashFileBackup) {
        const cacheDir = path.dirname(HASH_FILE);
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        fs.writeFileSync(HASH_FILE, hashFileBackup, 'utf8');
      }
      cleared = true;
    } catch (err) {
      console.warn('⚠ Failed to clear Turbopack cache:', err.message);
    }
  }

  if (cleared) {
    console.log('✓ Cache cleared successfully');
  }
}

/**
 * Main logic
 */
function main() {
  const currentHash = calculateDepsHash();
  const storedHash = getStoredHash();

  // Force cache clear on first run or when dependencies change
  const forceClean = process.env.FORCE_CLEAN === 'true';

  if (forceClean || currentHash !== storedHash) {
    if (forceClean) {
      console.log('🔄 Force cleaning cache (FORCE_CLEAN=true)...');
    } else {
      console.log('🔄 Dependency changes detected...');
    }
    clearNextCache();
    storeHash(currentHash);
  } else {
    console.log('✓ No dependency changes detected. Using existing cache.');
  }

  // Start Next.js dev server
  console.log('🚀 Starting Next.js dev server...\n');
  try {
    execSync('next dev', { stdio: 'inherit', cwd: ROOT });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

main();
