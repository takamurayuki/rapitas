/**
 * ProcessResourceSampler
 *
 * Polls a CLI agent child process's CPU time and RSS while it runs, and
 * reports the accumulated CPU time / peak RSS when sampling stops. No
 * external dependency (no pidusage) — Windows uses `tasklist` (the same
 * command family `agent-process-tracker.ts` already relies on; `wmic` is
 * removed on this dev machine), POSIX reads `/proc/<pid>` directly.
 */

import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { createLogger } from '../../config/logger';

const logger = createLogger('process-resource-sampler');

/** Polling interval in ms. Also used as the wait before the first re-sample. */
const POLL_INTERVAL_MS = 2000;

/** USER_HZ assumed for /proc/<pid>/stat utime+stime → ms conversion (glibc x86_64 default; no sysconf(_SC_CLK_TCK) equivalent in Node/Bun). */
const ASSUMED_USER_HZ = 100;

interface SamplerEntry {
  timer: ReturnType<typeof setInterval>;
  /** Last observed cumulative CPU time (ms). Not accumulated across samples — the OS already reports it cumulatively per-process. */
  cpuTimeMs: number | null;
  /** Highest RSS (KB) observed across all samples. */
  peakRssKb: number | null;
}

const registry = new Map<number, SamplerEntry>();

/**
 * Parse one `tasklist /v /fo csv /nh` output line into CPU time (ms) and memory (KB).
 *
 * @param line - Raw CSV line / 生のCSV行
 * @returns Parsed stats, or null if the line does not look like a tasklist CSV row / パース不能なら null
 */
export function parseTasklistCsvLine(
  line: string,
): { cpuTimeMs: number; peakRssKb: number } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('"')) return null;
  // Fields are double-quoted and comma-separated; values may themselves
  // contain commas (e.g. "12,345 K"), so split on the `","` field boundary
  // rather than a naive split(',').
  const fields = trimmed.slice(1, -1).split('","');
  if (fields.length < 8) return null;
  const memField = fields[4];
  const cpuField = fields[7];
  const memMatch = memField.replace(/,/g, '').match(/(\d+)\s*K/i);
  const cpuMatch = cpuField.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!memMatch || !cpuMatch) return null;
  const peakRssKb = parseInt(memMatch[1], 10);
  const hours = parseInt(cpuMatch[1], 10);
  const minutes = parseInt(cpuMatch[2], 10);
  const seconds = parseInt(cpuMatch[3], 10);
  const cpuTimeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (!Number.isFinite(peakRssKb) || !Number.isFinite(cpuTimeMs)) return null;
  return { cpuTimeMs, peakRssKb };
}

/**
 * Read one PID's stats via `tasklist` (Windows). Async — must never be
 * replaced with `execSync`: this runs every 2s for up to
 * `maxConcurrentAgents` processes concurrently, and a synchronous call would
 * repeatedly block the event loop and delay unrelated HTTP/SSE responses.
 *
 * @param pid - Target process ID / 対象PID
 * @returns Parsed stats or null on any failure (process gone, unparsable output) / 失敗時は null
 */
function readWindowsStats(pid: number): Promise<{ cpuTimeMs: number; peakRssKb: number } | null> {
  return new Promise((resolve) => {
    exec(`tasklist /fi "PID eq ${pid}" /v /fo csv /nh`, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve(null);
        return;
      }
      const line = stdout.split(/\r?\n/).find((l) => l.trim().startsWith('"'));
      resolve(line ? parseTasklistCsvLine(line) : null);
    });
  });
}

/**
 * Parse a `/proc/<pid>/stat` line into cumulative CPU time (ms).
 *
 * The comm field (2nd field) is parenthesized and may itself contain spaces
 * and `)` characters, so the split point is the LAST `)` in the line rather
 * than a naive whitespace split.
 *
 * @param statLine - Raw contents of /proc/<pid>/stat / stat の生内容
 * @returns CPU time in ms, or null if the line is malformed / パース不能なら null
 */
export function parseProcStatCpuTimeMs(statLine: string): number | null {
  const closeParen = statLine.lastIndexOf(')');
  if (closeParen === -1) return null;
  const rest = statLine
    .slice(closeParen + 1)
    .trim()
    .split(/\s+/);
  // rest[0]=state(3) rest[1]=ppid(4) ... rest[11]=utime(14) rest[12]=stime(15)
  const utime = Number(rest[11]);
  const stime = Number(rest[12]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  return (utime + stime) * (1000 / ASSUMED_USER_HZ);
}

/**
 * Parse a `/proc/<pid>/status` file's `VmRSS` line into KB.
 *
 * @param statusContent - Raw contents of /proc/<pid>/status / status の生内容
 * @returns RSS in KB, or null if the VmRSS line is absent/malformed / パース不能なら null
 */
export function parseProcStatusRssKb(statusContent: string): number | null {
  const match = statusContent.match(/^VmRSS:\s*(\d+)\s*kB$/m);
  if (!match) return null;
  const kb = parseInt(match[1], 10);
  return Number.isFinite(kb) ? kb : null;
}

/**
 * Read one PID's stats via `/proc` (Linux). Synchronous — `readFileSync` on
 * `/proc` returns instantly (no real I/O), unlike the Windows `exec` path.
 * On macOS `/proc` does not exist, so this throws and falls through to the
 * caller's try/catch → null, with no separate macOS branch needed.
 *
 * @param pid - Target process ID / 対象PID
 * @returns Parsed stats or null on any failure / 失敗時は null
 */
function readPosixStats(pid: number): { cpuTimeMs: number; peakRssKb: number } | null {
  try {
    const cpuTimeMs = parseProcStatCpuTimeMs(readFileSync(`/proc/${pid}/stat`, 'utf-8'));
    const peakRssKb = parseProcStatusRssKb(readFileSync(`/proc/${pid}/status`, 'utf-8'));
    if (cpuTimeMs === null || peakRssKb === null) return null;
    return { cpuTimeMs, peakRssKb };
  } catch {
    return null;
  }
}

/**
 * Take one sample for a tracked PID and merge it into the registry entry.
 * Failures are swallowed (warn-logged once) — the sampler is a best-effort
 * auxiliary measurement and must never affect the agent execution itself.
 *
 * @param pid - Target process ID / 対象PID
 */
async function sampleOnce(pid: number): Promise<void> {
  const entry = registry.get(pid);
  if (!entry) return;
  try {
    const stats = process.platform === 'win32' ? await readWindowsStats(pid) : readPosixStats(pid);
    if (!stats) return;
    entry.cpuTimeMs = stats.cpuTimeMs;
    entry.peakRssKb = Math.max(entry.peakRssKb ?? 0, stats.peakRssKb);
  } catch (error) {
    logger.warn({ err: error, pid }, '[ProcessResourceSampler] Sample failed');
  }
}

/**
 * Start polling a child process's CPU/RSS. Idempotent — calling twice for
 * the same PID is a no-op (the existing timer keeps running).
 *
 * @param pid - Target process ID / 対象PID
 */
export function startResourceSampling(pid: number): void {
  if (registry.has(pid)) return;
  const entry: SamplerEntry = {
    timer: setInterval(() => {
      void sampleOnce(pid);
    }, POLL_INTERVAL_MS),
    cpuTimeMs: null,
    peakRssKb: null,
  };
  registry.set(pid, entry);
  void sampleOnce(pid);
}

/**
 * Stop polling a child process and return its accumulated stats.
 *
 * @param pid - Target process ID / 対象PID
 * @returns Last-observed CPU time (ms) and peak RSS (KB); both null if no sample ever succeeded (e.g. the process exited before the first poll) / 一度も取得できなければ両方 null
 */
export function stopResourceSampling(pid: number): {
  cpuTimeMs: number | null;
  peakRssKb: number | null;
} {
  const entry = registry.get(pid);
  if (!entry) return { cpuTimeMs: null, peakRssKb: null };
  clearInterval(entry.timer);
  registry.delete(pid);
  return { cpuTimeMs: entry.cpuTimeMs, peakRssKb: entry.peakRssKb };
}
