#!/usr/bin/env node
/**
 * sync-version.cjs
 *
 * Synchronizes the project version across all package manifests.
 * Source of truth: root package.json -> "version" field.
 *
 * Usage:
 *   node scripts/sync-version.cjs              # sync all files to root version
 *   node scripts/sync-version.cjs --check      # exit 1 if any file is out of sync
 *   node scripts/sync-version.cjs 1.2.3        # set root + sync all
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/** @type {Array<{file: string, type: 'json' | 'cargo', jsonPath?: string[]}>} */
const TARGETS = [
  { file: 'package.json', type: 'json', jsonPath: ['version'] },
  { file: 'rapitas-desktop/package.json', type: 'json', jsonPath: ['version'] },
  { file: 'rapitas-desktop/src-tauri/tauri.conf.json', type: 'json', jsonPath: ['version'] },
  { file: 'rapitas-desktop/src-tauri/tauri.ci.conf.json', type: 'json', jsonPath: ['version'] },
  // tauri.build.conf.json and tauri.watch.conf.json are partial overlays merged
  // onto tauri.conf.json at runtime; they intentionally have no top-level version.
  { file: 'rapitas-desktop/src-tauri/Cargo.toml', type: 'cargo' },
];

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function getJsonVersion(obj, keyPath) {
  return keyPath.reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

/**
 * Surgical regex replace of a top-level "version" string field.
 * Avoids reformatting the rest of the file (e.g. compact arrays).
 * Only top-level "version" is supported (sufficient for our manifests).
 */
function writeJsonVersion(absPath, keyPath, value) {
  if (keyPath.length !== 1 || keyPath[0] !== 'version') {
    throw new Error(`Only top-level "version" key is supported (got ${keyPath.join('.')})`);
  }
  const text = fs.readFileSync(absPath, 'utf8');
  const re = /("version"\s*:\s*")[^"]+(")/;
  if (!re.test(text)) throw new Error(`No "version" field found in ${absPath}`);
  const updated = text.replace(re, `$1${value}$2`);
  fs.writeFileSync(absPath, updated);
}

function readCargoVersion(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  // Match the FIRST top-level [package] version, not workspace dep versions.
  const match = text.match(/^\s*\[package\][\s\S]*?^\s*version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function writeCargoVersion(absPath, version) {
  const text = fs.readFileSync(absPath, 'utf8');
  // Replace only the [package] section's version line.
  const updated = text.replace(
    /(^\s*\[package\][\s\S]*?^\s*version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`
  );
  if (updated === text) throw new Error(`Could not locate [package] version in ${absPath}`);
  fs.writeFileSync(absPath, updated);
}

function readVersion(target) {
  const abs = path.join(ROOT, target.file);
  if (target.type === 'json') return getJsonVersion(readJson(abs), target.jsonPath);
  return readCargoVersion(abs);
}

function writeVersion(target, version) {
  const abs = path.join(ROOT, target.file);
  if (target.type === 'json') {
    writeJsonVersion(abs, target.jsonPath, version);
  } else {
    writeCargoVersion(abs, version);
  }
}

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const explicit = args.find((a) => !a.startsWith('--'));

  const rootTarget = TARGETS[0];
  let target;
  if (explicit) {
    if (!SEMVER.test(explicit)) {
      console.error(`✗ Invalid semver: ${explicit}`);
      process.exit(1);
    }
    target = explicit;
  } else {
    target = readVersion(rootTarget);
  }

  if (checkOnly) {
    const mismatches = [];
    for (const t of TARGETS) {
      const v = readVersion(t);
      if (v !== target) mismatches.push({ file: t.file, found: v });
    }
    if (mismatches.length > 0) {
      console.error(`✗ Version mismatch (root says ${target}):`);
      for (const m of mismatches) console.error(`  - ${m.file}: ${m.found}`);
      console.error('Run: node scripts/sync-version.cjs');
      process.exit(1);
    }
    console.log(`✓ All ${TARGETS.length} files at version ${target}`);
    return;
  }

  let changed = 0;
  for (const t of TARGETS) {
    const cur = readVersion(t);
    if (cur === target) continue;
    writeVersion(t, target);
    console.log(`  ${t.file}: ${cur} -> ${target}`);
    changed++;
  }
  console.log(`✓ Synced ${changed} file(s) to version ${target}`);
}

main();
