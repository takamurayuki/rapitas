#!/usr/bin/env node
/**
 * check-test-isolation
 *
 * Guards the invariant the backend's mock-pollution safety depends on: bunfig.toml
 * must keep `isolate = true` under `[test]`. Without it, `bun.mock.module` calls in
 * one test file leak into the process-global module registry and pollute other
 * test files (silent false failures/passes across the suite). This is a pretest
 * gate — plain `fs` only, no dependencies — so it can never be skipped by a
 * missing `npm install`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BUNFIG_PATH = path.join(__dirname, '..', 'bunfig.toml');

function fail(message) {
  console.error(`\n[check-test-isolation] FAILED: ${message}`);
  console.error(
    '[check-test-isolation] `isolate = true` must remain set under [test] in bunfig.toml.\n' +
      'It prevents bun mock.module() state from leaking across test files (a known\n' +
      'source of silent cross-test pollution in this repo). Restore it before running tests.\n',
  );
  process.exit(1);
}

let content;
try {
  content = fs.readFileSync(BUNFIG_PATH, 'utf8');
} catch (err) {
  fail(`could not read ${BUNFIG_PATH}: ${err.message}`);
  return;
}

// NOTE: a plain substring check is enough here — this guards against the
// setting being deleted or commented out, not against exotic TOML formatting.
const hasIsolateTrue = /^\s*isolate\s*=\s*true\s*$/m.test(content);
if (!hasIsolateTrue) {
  fail('bunfig.toml no longer contains `isolate = true` under [test].');
}

console.log('[check-test-isolation] OK: bunfig.toml has isolate = true');
