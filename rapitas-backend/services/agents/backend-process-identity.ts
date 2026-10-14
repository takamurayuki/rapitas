/**
 * backend-process-identity
 *
 * Decides which PIDs are the rapitas backend itself, so the process reaper can
 * protect the backend without protecting whatever happens to hold its port.
 *
 * Why this exists. The reaper's guard was port-based: anything LISTENING on
 * 3001 was refused. Measured 2026-10-12 (ContextFlow task #1212) — a generated
 * project's Next.js dev server was started without a harness-assigned port,
 * fell back to 3000, found it taken, auto-incremented, and ended up on
 * `[::]:3001`. From that moment rapitas could not reap its own leftover: the
 * guard protected the intruder, so the ghost listener survived every sweep.
 * The same shape cost a two-hour outage on 2026-10-10.
 *
 * The Windows check also compared PIDs by substring against the whole `netstat`
 * output, so pid 275 matched a line for 27512 and unrelated processes were
 * protected at random.
 *
 * The backend is identified by IDENTITY, not by port: it is this very process
 * (the reaper runs inside the backend) and its ancestors (killing
 * backend-wrapper.ps1 takes the backend down with it). Everything else is
 * reapable, port or no port.
 *
 * NOT responsible for killing anything, or for taking the process snapshot —
 * agent-process-tracker and process-tree-kill own those.
 */

/**
 * PIDs LISTENING on one port, read from `netstat -aon` output.
 *
 * Parses the PID column instead of substring-matching the text, and matches the
 * port exactly so `:30011` is never read as `:3001`.
 *
 * @param netstatOutput - Raw `netstat -aon` text / netstat の生出力
 * @param port - Port to look for / 対象ポート
 * @returns PIDs listening on that port / LISTEN しているPID
 */
export function parseListenerPids(netstatOutput: string, port: number): number[] {
  const pids: number[] = [];
  for (const line of String(netstatOutput ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // Proto, Local Address, Foreign Address, State, PID
    if (cols.length < 5) continue;
    if (!/^LISTEN/i.test(cols[3])) continue;
    const local = cols[1];
    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    if (Number(local.slice(colon + 1)) !== port) continue;
    const pid = Number(cols[cols.length - 1]);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

/**
 * A PID and every ancestor reachable through `parentOf`, including itself.
 *
 * Stops at an unknown or already-seen parent, so a broken or cyclic parent link
 * cannot spin.
 *
 * @param pid - Starting process / 起点のプロセス
 * @param parentOf - Parent lookup; undefined ends the chain / 親の取得
 * @returns The pid and its ancestors / 自身と祖先
 */
export function ancestorPids(
  pid: number,
  parentOf: (pid: number) => number | undefined,
): Set<number> {
  const seen = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && current > 0 && !seen.has(current)) {
    seen.add(current);
    current = parentOf(current);
  }
  return seen;
}

/** How to recognise this backend. */
export interface BackendIdentityOpts {
  /** The backend's own PID (the reaper runs inside it). / 自プロセスのPID */
  selfPid: number;
  /** Parent lookup, for the wrapper chain above the backend. / 親の取得 */
  parentOf: (pid: number) => number | undefined;
}

/**
 * Whether killing this PID would take the backend down.
 *
 * True only for the backend process and its ancestors. Deliberately says
 * nothing about ports: a process listening on 3001 that is not in that chain is
 * an intruder shadowing the backend, and reaping it is the fix rather than the
 * hazard.
 *
 * @param pid - Candidate to kill / kill 対象の候補
 * @param opts - How to recognise the backend / バックエンドの識別方法
 * @returns True when the PID must not be killed / kill してはいけなければ true
 */
export function isProtectedBackendPid(pid: number, opts: BackendIdentityOpts): boolean {
  return ancestorPids(opts.selfPid, opts.parentOf).has(pid);
}
