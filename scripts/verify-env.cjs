#!/usr/bin/env node
/**
 * verify-env.cjs
 *
 * Validates `rapitas-backend/.env` against the keys declared in `.env.example`.
 * Checks that:
 *   1. .env exists at all
 *   2. Every key declared in .env.example is present in .env
 *   3. Required keys (REQUIRED_KEYS) have non-empty values
 *   4. DATABASE_URL is a syntactically plausible PostgreSQL URL
 *
 * Optional keys may be empty — that is intentional (e.g. AI provider keys are
 * configured via the UI for end users).
 *
 * Usage:
 *   node scripts/verify-env.cjs              # validate rapitas-backend/.env
 *   node scripts/verify-env.cjs path/to/.env # validate a custom file
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV = path.join(ROOT, 'rapitas-backend', '.env');
const EXAMPLE_ENV = path.join(ROOT, 'rapitas-backend', '.env.example');

/** Keys that MUST have a non-empty value for the backend to start. */
const REQUIRED_KEYS = new Set([
  'PORT',
  'NODE_ENV',
  'DATABASE_URL',
]);

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};
function ok(msg) { console.log(`${COLORS.green}✔${COLORS.reset} ${msg}`); }
function warn(msg) { console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`); }
function fail(msg) { console.error(`${COLORS.red}✖${COLORS.reset} ${msg}`); }
function info(msg) { console.log(`${COLORS.cyan}ℹ${COLORS.reset} ${msg}`); }

/**
 * Minimal dotenv parser. We avoid the dotenv dependency on purpose so this
 * script can run from a clean checkout before `npm install`.
 */
function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes (matching dotenv behavior).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readKeys(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return parseEnv(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const targetPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : DEFAULT_ENV;

  info(`Validating ${path.relative(ROOT, targetPath) || targetPath}`);

  const example = readKeys(EXAMPLE_ENV);
  if (!example) {
    fail(`.env.example not found at ${EXAMPLE_ENV}`);
    process.exit(1);
  }

  const env = readKeys(targetPath);
  if (!env) {
    fail(`.env not found at ${targetPath}`);
    info(`Create one with: cp ${path.relative(ROOT, EXAMPLE_ENV)} ${path.relative(ROOT, targetPath)}`);
    process.exit(1);
  }

  let errors = 0;
  let warnings = 0;

  // 1. Every key from .env.example must exist in .env (even if empty).
  const missing = Object.keys(example).filter((k) => !(k in env));
  if (missing.length > 0) {
    for (const k of missing) fail(`Missing key (declared in .env.example): ${k}`);
    errors += missing.length;
  }

  // 2. Required keys must have a non-empty value.
  for (const k of REQUIRED_KEYS) {
    if (!env[k] || env[k].trim() === '') {
      fail(`Required key is empty: ${k}`);
      errors++;
    }
  }

  // 3. DATABASE_URL plausibility.
  if (env.DATABASE_URL) {
    const url = env.DATABASE_URL;
    if (!/^postgres(ql)?:\/\/[^\s]+$/.test(url)) {
      fail(`DATABASE_URL does not look like a postgres URL: ${url}`);
      errors++;
    } else if (/:password@/.test(url) || /user:password/.test(url)) {
      warn('DATABASE_URL still contains the example placeholder credentials');
      warnings++;
    } else {
      ok('DATABASE_URL looks valid');
    }
  }

  // 4. Encryption key advisory.
  if (REQUIRED_KEYS.has('ENCRYPTION_KEY')) {
    if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) {
      warn('ENCRYPTION_KEY is empty or short — backend will auto-generate one on first start');
      warnings++;
    }
  }

  // 5. Unknown keys (declared in .env but not in .env.example) — informational only.
  const unknown = Object.keys(env).filter((k) => !(k in example));
  if (unknown.length > 0) {
    info(`Extra keys not in .env.example (ok, just FYI): ${unknown.join(', ')}`);
  }

  console.log('');
  if (errors > 0) {
    fail(`Validation failed: ${errors} error(s), ${warnings} warning(s)`);
    process.exit(1);
  }
  ok(`Validation passed${warnings > 0 ? ` (${warnings} warning(s))` : ''}`);
}

main();
