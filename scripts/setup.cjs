#!/usr/bin/env node
/**
 * setup.cjs
 *
 * Initial project setup script for rapitas.
 * Automates the following steps:
 *   1. Check prerequisites (node, bun, pnpm, PostgreSQL)
 *   2. Install dependencies for all subprojects
 *   3. Create .env file from .env.example (if missing)
 *   4. Initialize PostgreSQL database (optional)
 *   5. Run Prisma setup (generate + db push)
 *
 * Usage:
 *   node scripts/setup.cjs [--skip-db]    # skip database initialization
 *   node scripts/setup.cjs [--desktop]    # setup for Desktop/SQLite mode
 *   npm run setup                          # via package.json
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'rapitas-backend');
const FRONTEND_DIR = path.join(ROOT, 'rapitas-frontend');
const DESKTOP_DIR = path.join(ROOT, 'rapitas-desktop');

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(color, symbol, msg) {
  console.log(`${color}${symbol}${COLORS.reset} ${msg}`);
}
function ok(msg) { log(COLORS.green, '✔', msg); }
function warn(msg) { log(COLORS.yellow, '⚠', msg); }
function fail(msg) { log(COLORS.red, '✖', msg); }
function info(msg) { log(COLORS.cyan, 'ℹ', msg); }
function header(msg) {
  console.log(`\n${COLORS.bold}${COLORS.magenta}━━━ ${msg} ━━━${COLORS.reset}\n`);
}

let errors = 0;
let warnings = 0;

// --- CLI argument parsing ---
const SKIP_DB = process.argv.includes('--skip-db');
const DESKTOP_MODE = process.argv.includes('--desktop');

// --- Helper: generate secure random key ---
function generateSecureKey(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

// --- Helper: run command and return success ---
function runCommand(cmd, opts = {}) {
  try {
    execSync(cmd, {
      encoding: 'utf-8',
      stdio: opts.silent ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      timeout: opts.timeout || 300000, // 5 minutes default
      ...opts,
    });
    return true;
  } catch (err) {
    if (!opts.silent) {
      fail(`Command failed: ${cmd}`);
      if (err.stderr) console.error(err.stderr);
    }
    return false;
  }
}

// --- Helper: check if command exists ---
function commandExists(name, versionFlag = '--version') {
  try {
    const output = execSync(`${name} ${versionFlag}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();
    const version = output.split('\n')[0];
    ok(`${name} found: ${version}`);
    return true;
  } catch {
    fail(`${name} is not installed or not in PATH`);
    errors++;
    return false;
  }
}

// --- Helper: ask user for input ---
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${COLORS.cyan}?${COLORS.reset} ${query} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// --- Helper: approve pnpm build scripts ---
function approvePnpmBuilds(dir) {
  const settingsFile = path.join(dir, 'node_modules', '.pnpm', 'settings.json');

  // Check if we need to approve builds
  try {
    const result = execSync('pnpm config get enable-pre-post-scripts', {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // If pre/post scripts are disabled, we need to approve builds
    if (result === 'false') {
      info('Approving pnpm build scripts...');

      // Use --yes to auto-approve all build scripts
      const approveCmd = 'echo "yes" | pnpm config set enable-pre-post-scripts true';
      execSync(approveCmd, {
        cwd: dir,
        encoding: 'utf-8',
        stdio: 'inherit',
        shell: true,
      });

      ok('Build scripts approved');
      return true;
    }
  } catch (err) {
    // If command fails, settings might not exist yet - that's okay
  }

  return false;
}

// --- Step 1: Check prerequisites ---
async function checkPrerequisites() {
  header('Step 1: Checking prerequisites');

  const nodeOk = commandExists('node', '--version');
  const bunOk = commandExists('bun', '--version');
  const pnpmOk = commandExists('pnpm', '--version');

  if (!nodeOk || !bunOk || !pnpmOk) {
    fail('Missing required tools. Please install:');
    if (!nodeOk) console.log('  - Node.js: https://nodejs.org/');
    if (!bunOk) console.log('  - Bun: https://bun.sh/');
    if (!pnpmOk) console.log('  - pnpm: https://pnpm.io/');
    process.exit(1);
  }

  // PostgreSQL is optional (can use SQLite via Tauri)
  const pgOk = commandExists('psql', '--version');
  if (!pgOk) {
    warn('PostgreSQL not found. You can still use SQLite via Tauri desktop mode.');
    warn('For web mode, install PostgreSQL: https://www.postgresql.org/download/');
    warnings++;
  }

  ok('All required tools are installed');
}

// --- Step 2: Install dependencies ---
async function installDependencies() {
  header('Step 2: Installing dependencies');

  info('This may take a few minutes...');

  // Step 2.1: Install backend dependencies (Bun)
  info('Installing backend dependencies...');
  const backendSuccess = runCommand('bun install', { cwd: BACKEND_DIR });
  if (!backendSuccess) {
    fail('Failed to install backend dependencies');
    errors++;
    process.exit(1);
  }
  ok('Backend dependencies installed');

  // Step 2.2: Install frontend dependencies (pnpm)
  info('Installing frontend dependencies...');
  const frontendSuccess = runCommand('pnpm install --no-frozen-lockfile', { cwd: FRONTEND_DIR });
  if (!frontendSuccess) {
    fail('Failed to install frontend dependencies');
    errors++;

    // Check if it's a build script issue
    warn('Trying to resolve pnpm build script issues...');
    const resolveSuccess = runCommand('pnpm config set enable-pre-post-scripts true && pnpm install --no-frozen-lockfile', {
      cwd: FRONTEND_DIR,
      shell: true,
    });

    if (!resolveSuccess) {
      fail('Could not resolve frontend dependency issues');
      process.exit(1);
    }
  }
  ok('Frontend dependencies installed');

  // Step 2.3: Install desktop dependencies (pnpm)
  info('Installing desktop dependencies...');
  const desktopSuccess = runCommand('pnpm install --no-frozen-lockfile', { cwd: DESKTOP_DIR });
  if (!desktopSuccess) {
    fail('Failed to install desktop dependencies');
    errors++;

    // Check if it's a build script issue
    warn('Trying to resolve pnpm build script issues...');
    const resolveSuccess = runCommand('pnpm config set enable-pre-post-scripts true && pnpm install --no-frozen-lockfile', {
      cwd: DESKTOP_DIR,
      shell: true,
    });

    if (!resolveSuccess) {
      fail('Could not resolve desktop dependency issues');
      process.exit(1);
    }
  }
  ok('Desktop dependencies installed');

  ok('All dependencies installed successfully');
}

// --- Step 3: Setup .env file ---
async function setupEnvFile() {
  header('Step 3: Setting up .env file');

  const envPath = path.join(BACKEND_DIR, '.env');
  const examplePath = path.join(BACKEND_DIR, '.env.example');

  if (fs.existsSync(envPath)) {
    ok('.env file already exists');

    // If in desktop mode, ensure SQLite configuration
    if (DESKTOP_MODE) {
      await ensureDesktopConfig(envPath);
    }
    return;
  }

  if (!fs.existsSync(examplePath)) {
    fail('.env.example not found. Cannot create .env file.');
    errors++;
    return;
  }

  // Copy .env.example to .env
  fs.copyFileSync(examplePath, envPath);
  ok('.env file created from .env.example');

  // If in desktop mode, auto-configure for SQLite
  if (DESKTOP_MODE) {
    await setupDesktopMode(envPath);
    return;
  }

  info('You need to configure your .env file with the following:');
  console.log(`\n  ${COLORS.yellow}📝 Edit ${path.relative(ROOT, envPath)}${COLORS.reset}\n`);
  console.log('  Required configuration:');
  console.log('    - DATABASE_URL: PostgreSQL connection string (or file:./dev.db for SQLite)');
  console.log('    - ENCRYPTION_KEY: Generate with: node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
  console.log('    - ADMIN_SECRET: Generate with: node -e "console.log(crypto.randomBytes(16).toString(\'hex\'))"');
  console.log('');
  console.log('  Optional (can be set later via UI):');
  console.log('    - CLAUDE_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, etc.');
  console.log('');

  // Ask if user wants auto-configuration
  const autoConfig = await askQuestion('Would you like to auto-generate ENCRYPTION_KEY and ADMIN_SECRET? (Y/n)');
  if (autoConfig.toLowerCase() !== 'n' && autoConfig.toLowerCase() !== 'no') {
    await autoGenerateSecrets(envPath);
  }

  if (!SKIP_DB) {
    const answer = await askQuestion('Would you like to configure DATABASE_URL now? (y/N)');
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      await configureDatabaseUrl(envPath);
    } else {
      warn('Skipping DATABASE_URL configuration. You must set it manually before running the app.');
      warnings++;
    }
  }
}

// --- Helper: Auto-generate secrets ---
async function autoGenerateSecrets(envPath) {
  const encryptionKey = generateSecureKey(32);
  const adminSecret = generateSecureKey(16);

  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${encryptionKey}`);
  envContent = envContent.replace(/^ADMIN_SECRET=.*$/m, `ADMIN_SECRET=${adminSecret}`);
  fs.writeFileSync(envPath, envContent, 'utf-8');

  ok('Auto-generated ENCRYPTION_KEY and ADMIN_SECRET');
}

// --- Helper: Setup Desktop/SQLite mode ---
async function setupDesktopMode(envPath) {
  info('Configuring for Desktop/SQLite mode...');

  const encryptionKey = generateSecureKey(32);
  const adminSecret = generateSecureKey(16);

  let envContent = fs.readFileSync(envPath, 'utf-8');

  // Set SQLite database URL
  envContent = envContent.replace(
    /^DATABASE_URL=.*$/m,
    'DATABASE_URL=file:./dev.db'
  );

  // Set encryption key
  envContent = envContent.replace(
    /^ENCRYPTION_KEY=.*$/m,
    `ENCRYPTION_KEY=${encryptionKey}`
  );

  // Set admin secret
  envContent = envContent.replace(
    /^ADMIN_SECRET=.*$/m,
    `ADMIN_SECRET=${adminSecret}`
  );

  fs.writeFileSync(envPath, envContent, 'utf-8');

  ok('Configured for Desktop/SQLite mode');
  ok('DATABASE_URL set to: file:./dev.db');
  ok('ENCRYPTION_KEY and ADMIN_SECRET auto-generated');
}

// --- Helper: Ensure desktop config in existing .env ---
async function ensureDesktopConfig(envPath) {
  const envContent = fs.readFileSync(envPath, 'utf-8');

  // Check if already configured for SQLite
  if (envContent.includes('DATABASE_URL=file:')) {
    ok('Already configured for SQLite mode');
    return;
  }

  const answer = await askQuestion('Would you like to switch to SQLite mode for Desktop? (Y/n)');
  if (answer.toLowerCase() === 'n' || answer.toLowerCase() === 'no') {
    return;
  }

  await setupDesktopMode(envPath);
}

// --- Helper: Configure DATABASE_URL ---
async function configureDatabaseUrl(envPath) {
  console.log('\n' + COLORS.cyan + 'PostgreSQL Database Configuration:' + COLORS.reset);

  const dbUser = await askQuestion('Database user [postgres]:');
  const dbPassword = await askQuestion('Database password:');
  const dbHost = await askQuestion('Database host [localhost]:');
  const dbPort = await askQuestion('Database port [5432]:');
  const dbName = await askQuestion('Database name [rapitas]:');

  const user = dbUser || 'postgres';
  const password = dbPassword;
  const host = dbHost || 'localhost';
  const port = dbPort || '5432';
  const name = dbName || 'rapitas';

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${name}`;

  // Update .env file
  let envContent = fs.readFileSync(envPath, 'utf-8');
  envContent = envContent.replace(
    /^DATABASE_URL=.*/m,
    `DATABASE_URL=${databaseUrl}`
  );
  fs.writeFileSync(envPath, envContent, 'utf-8');

  ok('DATABASE_URL configured in .env');
}

// --- Step 4: Initialize database ---
async function initializeDatabase() {
  if (SKIP_DB) {
    warn('Skipping database initialization (--skip-db flag)');
    return;
  }

  header('Step 4: Initializing database');

  // Check if DATABASE_URL is configured
  const envPath = path.join(BACKEND_DIR, '.env');
  if (!fs.existsSync(envPath)) {
    fail('.env file not found. Cannot initialize database.');
    errors++;
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const dbUrlMatch = envContent.match(/^DATABASE_URL=(.+)$/m);

  if (!dbUrlMatch || dbUrlMatch[1].includes('user:password')) {
    warn('DATABASE_URL not configured. Skipping database initialization.');
    warn('Configure DATABASE_URL in .env and run: cd rapitas-backend && npx prisma db push');
    warnings++;
    return;
  }

  const databaseUrl = dbUrlMatch[1];

  // Check if using SQLite
  if (databaseUrl.startsWith('file:')) {
    info('SQLite mode detected');

    // Generate Prisma client
    info('Running Prisma generate...');
    const generateSuccess = runCommand('bun run prisma generate', { cwd: BACKEND_DIR });
    if (!generateSuccess) {
      fail('Prisma generate failed');
      errors++;
      return;
    }
    ok('Prisma client generated');

    // Prepare SQLite init SQL
    info('Preparing SQLite initialization...');
    const sqliteSuccess = runCommand('bun run db:prepare:sqlite', { cwd: BACKEND_DIR });
    if (!sqliteSuccess) {
      fail('SQLite preparation failed');
      errors++;
      return;
    }
    ok('SQLite initialization prepared');
    info('Database will be auto-created on first run');

    return;
  }

  // PostgreSQL mode
  info('PostgreSQL mode detected');

  info('Running Prisma generate...');
  const generateSuccess = runCommand('bun run prisma generate', { cwd: BACKEND_DIR });
  if (!generateSuccess) {
    fail('Prisma generate failed');
    errors++;
    return;
  }

  info('Running Prisma db push...');
  const pushSuccess = runCommand('bun run prisma db push --skip-generate', { cwd: BACKEND_DIR });
  if (!pushSuccess) {
    fail('Prisma db push failed. Please check your DATABASE_URL and PostgreSQL server.');
    errors++;
    return;
  }

  ok('Database initialized successfully');
}

// --- Step 5: Summary ---
async function showSummary() {
  header('Setup Complete!');

  if (errors > 0) {
    fail(`Setup completed with ${errors} error(s) and ${warnings} warning(s)`);
    console.log('\nPlease fix the errors above and run the setup again if needed.\n');
    process.exit(1);
  }

  if (warnings > 0) {
    warn(`Setup completed with ${warnings} warning(s)`);
  } else {
    ok('Setup completed successfully with no errors');
  }

  console.log('\n' + COLORS.bold + '🚀 Next Steps:' + COLORS.reset + '\n');

  if (DESKTOP_MODE) {
    console.log('  Desktop/SQLite mode is configured!');
    console.log('');
    console.log('  Start the desktop application:');
    console.log(`     ${COLORS.green}npm run dev:tauri${COLORS.reset}         # Desktop mode (SQLite)`);
    console.log('');
    console.log('  Or test in web mode:');
    console.log(`     ${COLORS.green}npm run dev${COLORS.reset}               # Web mode (with SQLite)`);
  } else {
    console.log('  1. Configure your .env file (if not done):');
    console.log(`     ${COLORS.cyan}code rapitas-backend/.env${COLORS.reset}`);
    console.log('');
    console.log('  2. Start the development server:');
    console.log(`     ${COLORS.green}npm run dev${COLORS.reset}               # Web mode (PostgreSQL/SQLite)`);
    console.log(`     ${COLORS.green}npm run dev:tauri${COLORS.reset}         # Desktop mode (SQLite)`);
  }

  console.log('');
  console.log('  3. Access the application:');
  console.log(`     ${COLORS.cyan}http://localhost:3000${COLORS.reset}     # Frontend`);
  console.log(`     ${COLORS.cyan}http://localhost:3001${COLORS.reset}     # Backend API`);
  console.log('');

  if (DESKTOP_MODE) {
    console.log(`  ${COLORS.green}✔${COLORS.reset} SQLite database will be auto-created on first run`);
    console.log(`  ${COLORS.green}✔${COLORS.reset} ENCRYPTION_KEY and ADMIN_SECRET are configured`);
    console.log('');
  }

  console.log('  📚 For more information, see README.md');
  console.log('');
}

// --- Main execution ---
async function main() {
  console.log(`\n${COLORS.bold}${COLORS.magenta}╔════════════════════════════════════════╗${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.magenta}║   Rapitas Project Setup Script         ║${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.magenta}╚════════════════════════════════════════╝${COLORS.reset}\n`);

  if (DESKTOP_MODE) {
    info('Running in Desktop/SQLite mode');
    console.log('');
  }

  try {
    await checkPrerequisites();
    await installDependencies();
    await setupEnvFile();
    await initializeDatabase();
    await showSummary();
  } catch (err) {
    fail(`Setup failed: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

main();
