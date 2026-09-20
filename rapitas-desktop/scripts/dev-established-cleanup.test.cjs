'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectPeerPids, killDeadPidEstablishedPeers } = require('./dev-established-cleanup.cjs');

const PORT = 3001;
const DEAD = 22712;
const conns = [
  // server side of the dead backend's connections (client ports 50001, 50002, 50003)
  { LocalPort: PORT, RemotePort: 50001, State: 'Established', OwningProcess: DEAD },
  { LocalPort: PORT, RemotePort: 50002, State: 'Established', OwningProcess: DEAD },
  { LocalPort: PORT, RemotePort: 50003, State: 'Established', OwningProcess: 9999 }, // live backend
  // client side
  { LocalPort: 50001, RemotePort: PORT, State: 'Established', OwningProcess: 111 }, // hung curl
  { LocalPort: 50002, RemotePort: PORT, State: 'Established', OwningProcess: 222 }, // interactive claude
  { LocalPort: 50003, RemotePort: PORT, State: 'Established', OwningProcess: 333 }, // live-backend client
];
const isRunning = (pid) => pid !== DEAD;

test('selects only clients connected to a dead owner', () => {
  assert.deepEqual(selectPeerPids({ connections: conns, port: PORT, isRunning }), [111, 222]);
});

test('never selects the dead owner, pid 0, or own pid', () => {
  const extra = [
    { LocalPort: 50009, RemotePort: PORT, State: 'Established', OwningProcess: 0 },
    { LocalPort: PORT, RemotePort: 50009, State: 'Established', OwningProcess: DEAD },
  ];
  assert.deepEqual(
    selectPeerPids({ connections: extra, port: PORT, isRunning, ownPid: process.pid }),
    [],
  );
});

test('no dead owner means nothing to kill', () => {
  assert.deepEqual(selectPeerPids({ connections: conns, port: PORT, isRunning: () => true }), []);
});

test('kills only killable peers (hung curl), leaving interactive claude alone', () => {
  const killed = [];
  const result = killDeadPidEstablishedPeers(PORT, {
    connections: conns,
    isRunning,
    isKillable: (pid) => pid === 111,
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, [111]);
  assert.deepEqual(result, { killed: [111], skipped: [222] });
});

test('never kills the live backend pid even if the guard wrongly allows it', () => {
  const killed = [];
  killDeadPidEstablishedPeers(PORT, {
    connections: conns,
    isRunning,
    isKillable: () => true,
    kill: (pid) => killed.push(pid),
    protectedPids: [222],
  });
  assert.deepEqual(killed, [111]);
});

test('rapitas-owned peers (node/bun) are killable via isRapitasOwned; strangers are not', () => {
  const { makeIsKillable } = require('./dev-established-cleanup.cjs');
  const isKillable = makeIsKillable({
    isCurl: (pid) => pid === 1,
    isRapitasOwned: (pid) => pid === 2,
  });
  assert.equal(isKillable(1), true);
  assert.equal(isKillable(2), true);
  assert.equal(isKillable(3), false);
});

test('killDeadPidEstablishedPeers kills an isRapitasOwned peer end to end', () => {
  const killed = [];
  killDeadPidEstablishedPeers(PORT, {
    connections: conns,
    isRunning,
    isRapitasOwned: (pid) => pid === 222,
    kill: (pid) => killed.push(pid),
  });
  assert.deepEqual(killed, [222]);
});
