'use strict';

/**
 * dev-established-cleanup
 *
 * Finds the clients still ESTABLISHED to a DEAD previous backend on `port` and
 * kills the hung ones (curl, or rapitas-owned node/bun; never interactive claude),
 * so the dead LISTEN socket is not kept alive as a ghost. Not responsible for
 * zombie/ghost LISTEN handling (see dev.js).
 * NOTE: relies on Get-NetTCPConnection still reporting the dead pid as the
 * server-side OwningProcess (observed for the ghost case); if the OS drops those
 * rows the function simply finds nothing and is a no-op.
 * Context: task #907's ci_repair killed the backend and two hung curl clients
 * kept its LISTEN ghosted for 30 minutes (task #996).
 */
const { execSync } = require('child_process');

/**
 * Pure selection of client PIDs connected to dead server-side owners.
 *
 * @param {{connections: Array<{LocalPort:number,RemotePort:number,State:string,OwningProcess:number}>, port:number, isRunning:(pid:number)=>boolean, ownPid?:number}} args
 * @returns {number[]} Client PIDs (sorted, unique) / クライアントPID
 */
function selectPeerPids({ connections, port, isRunning, ownPid }) {
  const established = connections.filter((c) => c.State === 'Established');
  const deadClientPorts = new Set(
    established
      .filter((c) => c.LocalPort === port && c.OwningProcess > 0 && !isRunning(c.OwningProcess))
      .map((c) => c.RemotePort),
  );
  const pids = new Set();
  for (const c of established) {
    if (c.RemotePort !== port || !deadClientPorts.has(c.LocalPort)) continue;
    if (c.OwningProcess > 0 && c.OwningProcess !== ownPid && isRunning(c.OwningProcess)) {
      pids.add(c.OwningProcess);
    }
  }
  return [...pids].sort((a, b) => a - b);
}

function listConnections(port) {
  const ps = `Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -eq ${port} -or $_.RemotePort -eq ${port} } | Select-Object LocalPort,RemotePort,OwningProcess,@{n='State';e={'Established'}} | ConvertTo-Json -Compress`;
  const out = execSync(`powershell -NoProfile -Command "${ps}"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
  }).trim();
  if (!out) return [];
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function defaultIsRunning(pid) {
  try {
    return execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    }).includes(String(pid));
  } catch {
    return false;
  }
}

function defaultIsCurl(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return /^"curl(\.exe)?"/i.test(out.trim());
  } catch {
    return false;
  }
}

/**
 * Killable = a hung curl, or a node/bun process dev.js recognizes as rapitas-owned
 * (`isRapitasOwned`, which never matches an interactive claude session).
 *
 * @param {{isCurl?: (pid:number)=>boolean, isRapitasOwned?: (pid:number)=>boolean}} [deps]
 * @returns {(pid:number)=>boolean} Predicate / 判定関数
 */
function makeIsKillable(deps = {}) {
  const isCurl = deps.isCurl || defaultIsCurl;
  const isRapitasOwned = deps.isRapitasOwned || (() => false);
  return (pid) => isCurl(pid) || isRapitasOwned(pid);
}

function defaultKill(pid) {
  execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
}

/**
 * Kill hung clients ESTABLISHED to a dead previous backend on `port`.
 *
 * @param {number} port - Backend port / バックエンドポート
 * @param {object} [deps] - Injectable deps (tests) / テスト用の差し替え
 * @returns {{killed:number[], skipped:number[]}} Outcome / 結果
 */
function killDeadPidEstablishedPeers(port, deps = {}) {
  const result = { killed: [], skipped: [] };
  try {
    const isRunning = deps.isRunning || defaultIsRunning;
    const isKillable = deps.isKillable || makeIsKillable({ isRapitasOwned: deps.isRapitasOwned });
    const kill = deps.kill || defaultKill;
    const protectedPids = new Set([process.pid, ...(deps.protectedPids || [])]);
    const connections = deps.connections || listConnections(port);
    for (const pid of selectPeerPids({ connections, port, isRunning, ownPid: process.pid })) {
      if (protectedPids.has(pid) || !isKillable(pid)) {
        result.skipped.push(pid);
        continue;
      }
      try {
        kill(pid);
        result.killed.push(pid);
        console.log(`  Killed hung client PID ${pid} of dead backend on port ${port}`);
      } catch {
        result.skipped.push(pid);
      }
    }
  } catch {
    // PowerShell unavailable / no sockets — best-effort only.
  }
  return result;
}

module.exports = { selectPeerPids, killDeadPidEstablishedPeers, makeIsKillable };
