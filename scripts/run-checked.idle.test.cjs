#!/usr/bin/env node
/**
 * run-checked.idle.test.cjs
 *
 * 2026-11-28: a verifier ran the whole backend suite through run-checked, four
 * files at a time. Four `bun test` runs printed their file header and then
 * nothing for 12 minutes, and run-checked waited on them forever (no timeout
 * by default), so the verify phase stalled. A command that stays silent past
 * the idle limit is now stopped with exit 124.
 * Run with: node --test scripts/run-checked.idle.test.cjs
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'run-checked.cjs');
const NODE = JSON.stringify(process.execPath);

function run(args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'run-checked-idle-'));
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

test('a command silent past the idle limit is stopped with exit 124', () => {
  const silent = `${NODE} -e "console.log('header'),setTimeout(()=>{},8000)"`;
  const { status, stdout } = run(['--idle-timeout-ms', '600', '--', silent]);
  assert.equal(status, 124);
  assert.match(stdout, /no output for 600ms/);
  assert.match(stdout, /exitCode=124 \(idle\)/);
});

test('a command that keeps printing is not stopped by the idle limit', () => {
  const chatty = `${NODE} -e "setInterval(()=>console.log(Date.now()),200),setTimeout(()=>process.exit(0),1500)"`;
  const { status, stdout } = run(['--idle-timeout-ms', '600', '--', chatty]);
  assert.equal(status, 0);
  assert.match(stdout, /exitCode=0/);
});

test('the idle limit is on by default and 0 turns it off', () => {
  const { status } = run(['--idle-timeout-ms', '0', '--', `${NODE} -e "setTimeout(()=>{},300)"`]);
  assert.equal(status, 0);
  const bad = run(['--idle-timeout-ms', 'NaN', '--', `${NODE} -e "0"`]);
  assert.equal(bad.status, 2);
});
