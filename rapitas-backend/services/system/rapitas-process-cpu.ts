/**
 * RapitasProcessCpu
 *
 * Measures the CPU used by rapitas's own process tree: the backend and every
 * descendant (agent worker, agent CLIs, verification shells and the tsc / bun
 * they start). Pure helpers plus one snapshot reader. Not responsible for the
 * sampling schedule (resource-telemetry.ts) or the hold decision
 * (resource-contention-gate.ts).
 *
 * Why the whole tree: verification runs through `shell: true`, so the direct
 * child is cmd.exe and the real work (tsc, bun) is a grandchild. Counting only
 * direct children under-reports and the gate would never hold (task 1553).
 */
import { execFile } from 'child_process';
import { lowerProcessPriority } from '../agents/process-priority';

/** One process in a snapshot: cumulative CPU time (user + kernel) in ms. */
export interface ProcSample {
  pid: number;
  ppid: number;
  cpuMs: number;
}

/** CPU used by the tree between two consecutive snapshots. */
export interface CpuInterval {
  /** When the later snapshot was taken (epoch ms). */
  at: number;
  /** Tree CPU time spent in the interval (ms, summed across cores). */
  cpuMs: number;
  /** Wall-clock length of the interval (ms). */
  elapsedMs: number;
}

/**
 * Parses `pid,ppid,ticks` lines where ticks are 100 ns units (CIM's
 * UserModeTime + KernelModeTime). Non-matching lines are ignored.
 *
 * @param out - PowerShell stdout. / PowerShell の出力
 * @returns Snapshot rows. / スナップショット
 */
export function parseCimOutput(out: string): ProcSample[] {
  const rows: ProcSample[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+),(\d+),(\d+)\s*$/.exec(line);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cpuMs: Number(m[3]) / 10_000 });
  }
  return rows;
}

/**
 * Parses ps's `time` column ([[dd-]hh:]mm:ss[.frac]) into ms.
 *
 * @param value - ps time text. / ps の時間表記
 * @returns Milliseconds, or null when unparseable. / ミリ秒（解釈できなければ null）
 */
export function parsePsTime(value: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!m) return null;
  const [, d, h, min, s] = m;
  const seconds = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s);
  return Math.round(seconds * 1000);
}

/**
 * Parses `ps -A -o pid=,ppid=,time=` output.
 *
 * @param out - ps stdout. / ps の出力
 * @returns Snapshot rows. / スナップショット
 */
export function parsePsOutput(out: string): ProcSample[] {
  const rows: ProcSample[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    if (!m) continue;
    const cpuMs = parsePsTime(m[3]!);
    if (cpuMs === null) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), cpuMs });
  }
  return rows;
}

/**
 * The root process and all its descendants, minus `excludePids` (the sampler
 * itself). Processes outside the tree — other applications — never appear.
 *
 * @param snapshot - All processes on the host. / ホスト上の全プロセス
 * @param rootPid - Tree root (the backend's pid). / ルート（バックエンド）の pid
 * @param excludePids - Pids to drop, e.g. the sampler. / 除外する pid
 * @returns Rows belonging to the tree. / ツリーに属する行
 */
export function collectTree(
  snapshot: ProcSample[],
  rootPid: number,
  excludePids: Set<number>,
): ProcSample[] {
  const byPid = new Map(snapshot.map((s) => [s.pid, s]));
  if (!byPid.has(rootPid)) return [];
  const children = new Map<number, ProcSample[]>();
  for (const s of snapshot) {
    const list = children.get(s.ppid) ?? [];
    list.push(s);
    children.set(s.ppid, list);
  }
  const seen = new Set<number>();
  const out: ProcSample[] = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue; // pid reuse can form a ppid cycle
    seen.add(pid);
    const row = byPid.get(pid);
    if (row && !excludePids.has(pid)) out.push(row);
    for (const c of children.get(pid) ?? []) stack.push(c.pid);
  }
  return out;
}

/**
 * CPU time the tree spent between two snapshots. A pid seen for the first
 * time adds its whole value (it started inside the interval); a pid whose
 * counter went backwards was reused and also counts as new. Processes that
 * exited between the snapshots are lost — that errs toward NOT holding.
 *
 * @param prev - Earlier tree rows. / 前回のツリー
 * @param cur - Later tree rows. / 今回のツリー
 * @returns Interval CPU (ms). / 区間の CPU 時間（ms）
 */
export function computeIntervalCpuMs(prev: ProcSample[], cur: ProcSample[]): number {
  const before = new Map(prev.map((s) => [s.pid, s.cpuMs]));
  let total = 0;
  for (const s of cur) {
    const p = before.get(s.pid);
    total += p === undefined || s.cpuMs < p ? s.cpuMs : s.cpuMs - p;
  }
  return total;
}

/**
 * Average tree CPU over the window, as a percentage of host capacity
 * (elapsed × logical cores): one fully busy core on a 4-core host is 25%.
 *
 * @param intervals - Recorded intervals. / 記録済みの区間
 * @param windowMs - Window length. / 窓の長さ
 * @param cores - Logical cores. / 論理コア数
 * @param now - Current time (epoch ms). / 現在時刻
 * @returns Percent in [0, 100], or null with no interval in the window. / 百分率、区間が無ければ null
 */
export function windowAveragePercent(
  intervals: CpuInterval[],
  windowMs: number,
  cores: number,
  now: number,
): number | null {
  const inWindow = intervals.filter((i) => i.at >= now - windowMs && i.elapsedMs > 0);
  if (inWindow.length === 0) return null;
  const cpu = inWindow.reduce((sum, i) => sum + i.cpuMs, 0);
  const capacity = inWindow.reduce((sum, i) => sum + i.elapsedMs, 0) * Math.max(1, cores);
  return Math.max(0, Math.min(100, (cpu / capacity) * 100));
}

// One CIM call returns pid, parent pid and cumulative CPU for every process.
// PS 5.1's Get-Process has no parent pid and wmic is gone on this host.
const CIM_SCRIPT =
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,UserModeTime,KernelModeTime | ' +
  'ForEach-Object { "$($_.ProcessId),$($_.ParentProcessId),$($_.UserModeTime + $_.KernelModeTime)" }';

/**
 * Reads a whole-host process snapshot and the reader's own pid (to exclude it).
 * Runs at BELOW_NORMAL priority. Rejects when the command fails.
 *
 * @returns Snapshot rows and the sampler process pid. / スナップショットと採取プロセスの pid
 */
export function readProcessSnapshot(): Promise<{ rows: ProcSample[]; samplerPid?: number }> {
  const win = process.platform === 'win32';
  const file = win ? 'powershell' : 'ps';
  const args = win
    ? ['-NoProfile', '-NonInteractive', '-Command', CIM_SCRIPT]
    : ['-A', '-o', 'pid=,ppid=,time='];
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        const text = String(stdout ?? '');
        resolve({
          rows: win ? parseCimOutput(text) : parsePsOutput(text),
          samplerPid: child.pid,
        });
      },
    );
    lowerProcessPriority(child.pid, 'RAPITAS_VERIFY_QUIET');
  });
}
