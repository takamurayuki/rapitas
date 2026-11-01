'use strict';
/**
 * port-ownership.test
 *
 * The incident this encodes (2026-10-29): another project's Rails dev server
 * held 127.0.0.1:3000, dev.js correctly refused to kill it, and said only
 * "does not look rapitas-related — skipping kill". Startup continued, the
 * window showed the other project, and finding out why took reading
 * Get-NetTCPConnection by hand.
 *
 * The trap on the other side: `isRapitasOwnedProcess` is known to
 * false-negative on OUR OWN orphan from a previous run — a leftover bun.exe
 * is invoked as a bare `bun index.ts` from `~/.bun/bin`, so nothing in it
 * says "rapitas". Anything built on "not confirmed ours" must therefore not
 * treat that orphan as another program's server.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyOccupancy, describePortConflict } = require('./port-ownership.cjs');

/** Nothing can be confirmed — the worst case for the classifier. */
const confirmsNothing = () => false;

test('a port nobody listens on is free', () => {
  const result = classifyOccupancy({ occupants: [], isRapitasOwned: confirmsNothing });
  assert.equal(result.kind, 'free');
  assert.deepEqual(result.foreign, []);
});

test('a confirmed rapitas process is reclaimable', () => {
  const result = classifyOccupancy({
    occupants: [{ pid: 2000, name: 'bun.exe' }],
    isRapitasOwned: () => true,
  });
  assert.equal(result.kind, 'reclaimable');
  assert.deepEqual(result.foreign, []);
});

// The regression guard. Refusing startup here would wedge every cold start
// after a crash, which is the exact failure the identity guard's own comments
// describe fighting.
test('an unconfirmed bun.exe is OUR orphan, not another program', () => {
  const result = classifyOccupancy({
    occupants: [{ pid: 11, name: 'bun.exe', commandLine: 'bun index.ts' }],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'reclaimable');
  assert.deepEqual(result.foreign, []);
});

test('an unconfirmed node.exe is also treated as ours', () => {
  const result = classifyOccupancy({
    occupants: [{ pid: 12, name: 'node.exe' }],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'reclaimable');
});

// What the incident actually looked like: a process rapitas never spawns.
test('a program rapitas never starts is foreign', () => {
  const result = classifyOccupancy({
    occupants: [{ pid: 23644, name: 'ruby.exe', commandLine: 'bin/rails server -p 3000' }],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'foreign');
  assert.equal(result.foreign.length, 1);
  assert.equal(result.foreign[0].pid, 23644);
});

test('an unreadable process name is not asserted to be foreign', () => {
  // Win32_Process returns null Name for some processes; guessing "foreign"
  // there would put a scary message in front of an ordinary restart.
  const result = classifyOccupancy({
    occupants: [{ pid: 13, name: null }],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'reclaimable');
});

test('one foreign holder beside one of ours stays reclaimable', () => {
  // Killing ours can still free the port, so startup must not be given up on
  // — but the foreign one is still named, so the log can mention it.
  const result = classifyOccupancy({
    occupants: [
      { pid: 23644, name: 'ruby.exe' },
      { pid: 2000, name: 'bun.exe' },
    ],
    isRapitasOwned: (pid) => pid === 2000,
  });
  assert.equal(result.kind, 'reclaimable');
  assert.deepEqual(
    result.foreign.map((o) => o.pid),
    [23644],
  );
});

test('every foreign holder is listed, not just the first', () => {
  const result = classifyOccupancy({
    occupants: [
      { pid: 11, name: 'ruby.exe' },
      { pid: 12, name: 'python.exe' },
    ],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'foreign');
  assert.equal(result.foreign.length, 2);
});

test('the process-name check ignores case', () => {
  const result = classifyOccupancy({
    occupants: [{ pid: 14, name: 'BUN.EXE' }],
    isRapitasOwned: confirmsNothing,
  });
  assert.equal(result.kind, 'reclaimable');
});

test('the conflict message names the port, the process and what to do', () => {
  const text = describePortConflict({
    port: 3000,
    foreign: [
      {
        pid: 23644,
        name: 'ruby.exe',
        commandLine: '"C:\Ruby40-x64\bin\ruby.exe" bin/rails server -p 3000',
      },
    ],
  }).join('\n');
  assert.match(text, /3000/);
  assert.match(text, /23644/);
  assert.match(text, /ruby\.exe/);
  assert.match(text, /rails server -p 3000/);
  // An operator reading this must be told the remedy, not just the fact.
  assert.match(text, /another port|Stop/i);
});

test('the message survives a process whose command line could not be read', () => {
  const text = describePortConflict({
    port: 3000,
    foreign: [{ pid: 7, name: null, commandLine: null }],
  }).join('\n');
  assert.match(text, /PID 7/);
  assert.doesNotMatch(text, /undefined|null/);
});
