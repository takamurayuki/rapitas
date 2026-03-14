/**
 * Preflight check script
 * Validates that all prerequisites are met before starting the dev environment.
 * Run automatically via `npm run dev` (predev hook).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(ROOT, 'rapitas-backend');
const FRONTEND_DIR = path.join(ROOT, 'rapitas-frontend');

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
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

let errors = 0;
let warnings = 0;

// --- 1. Check runtime tools ---
function checkCommand(name, versionFlag = '--version') {
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

// --- 2. Check .env files ---
function checkEnvFile(dir, name) {
  const envPath = path.join(dir, '.env');
  const envLocalPath = path.join(dir, '.env.local');
  const examplePath = path.join(dir, '.env.example');

  if (fs.existsSync(envPath)) {
    ok(`${name}/.env exists`);
    return true;
  }
  if (fs.existsSync(envLocalPath)) {
    ok(`${name}/.env.local exists`);
    return true;
  }

  if (fs.existsSync(examplePath)) {
    warn(`${name}/.env is missing. Copy from .env.example:`);
    console.log(`   cp ${name}/.env.example ${name}/.env`);
    warnings++;
  } else {
    fail(`${name}/.env is missing and no .env.example found`);
    errors++;
  }
  return false;
}

// --- 3. Check node_modules ---
function checkDeps(dir, name, lockFile) {
  const modulesPath = path.join(dir, 'node_modules');
  if (fs.existsSync(modulesPath)) {
    ok(`${name}/node_modules exists`);
    return true;
  }
  fail(`${name}/node_modules is missing. Run: npm run install:all`);
  errors++;
  return false;
}

// --- 4. Check port availability ---
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        warn(`Port ${port} is already in use (may be a running dev server)`);
        warnings++;
      }
      resolve(false);
    });
    server.once('listening', () => {
      server.close();
      ok(`Port ${port} is available`);
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

// --- 5. Check DATABASE_URL ---
function checkDatabaseUrl() {
  const envPath = path.join(BACKEND_DIR, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (match && match[1].trim()) {
    ok('DATABASE_URL is configured');
  } else {
    fail('DATABASE_URL is not set in rapitas-backend/.env');
    errors++;
  }
}

// --- Main ---
async function main() {
  console.log(`\n${COLORS.bold}${COLORS.cyan}=== Rapitas Preflight Check ===${COLORS.reset}\n`);

  // Runtime tools
  info('Checking runtime tools...');
  checkCommand('bun');
  checkCommand('pnpm');
  checkCommand('node');
  console.log();

  // Environment files
  info('Checking environment files...');
  checkEnvFile(BACKEND_DIR, 'rapitas-backend');
  checkEnvFile(FRONTEND_DIR, 'rapitas-frontend');
  checkDatabaseUrl();
  console.log();

  // Dependencies
  info('Checking dependencies...');
  checkDeps(BACKEND_DIR, 'rapitas-backend');
  checkDeps(FRONTEND_DIR, 'rapitas-frontend');
  console.log();

  // Port availability
  info('Checking port availability...');
  await checkPort(3001);
  await checkPort(3000);
  console.log();

  // Summary
  console.log(`${COLORS.bold}--- Summary ---${COLORS.reset}`);
  if (errors > 0) {
    fail(`${errors} error(s) found. Fix them before starting the dev server.`);
    process.exit(1);
  } else if (warnings > 0) {
    warn(`${warnings} warning(s). Dev server may still work, but check the warnings above.`);
  } else {
    ok('All checks passed!');
  }
  console.log();
}

main();
