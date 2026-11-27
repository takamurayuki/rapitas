/**
 * pid-alive
 *
 * In-process check that a process id is still in use, without launching any
 * helper process. Not responsible for proving the PID still belongs to the
 * same program (PID reuse) — callers that kill must check identity too.
 */

/**
 * Whether a process with this id exists. `process.kill(pid, 0)` sends no
 * signal; on Windows, Bun answers it from the OS process table.
 *
 * NOTE: Replaces `tasklist /FI "PID eq N"`, which launched cmd + tasklist
 * (about 250 ms each, plus a Defender scan) every 10 s around the clock
 * (2026-11-27).
 *
 * @param pid - Process id / プロセスID
 * @returns true when the id is in use (EPERM also means it exists) / 存在するか
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
