/**
 * agent-reap
 *
 * After an agent CLI exits, reap what it left running: its own tree, and —
 * when it ran inside a task worktree — processes whose command line names
 * that worktree. Not responsible for deciding what is safe to kill:
 * killProcessTreeSafely keeps the backend and its ancestors out of reach.
 *
 * NOTE: Verifiers started apps with start.bat / Start-Process, which detaches
 * them from the agent's tree. The reap only knew the agent's descendants, so
 * server.exe / worker.exe stayed up holding port 8090 and every following
 * verification of trendline task 1520 failed with "port in use" (2026-11-22).
 */
import { captureDescendants, killProcessTreeSafely } from './agent-process-tracker';

/** Grace after the CLI's stdio closed; on Windows that is not process exit. */
const REAP_DELAY_MS = 3000;

/** Side effects of {@link scheduleAgentReap}, injectable for tests. */
export interface ReapDeps {
  capture: (pid: number) => Set<number>;
  kill: (pid: number, opts: { workdir?: string; knownTargets?: Iterable<number> }) => boolean;
  schedule: (fn: () => void) => void;
}

const liveDeps: ReapDeps = {
  capture: captureDescendants,
  kill: killProcessTreeSafely,
  schedule: (fn) => {
    const timer = setTimeout(fn, REAP_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
  },
};

/** True for a per-task worktree path (…/.worktrees/<name>), never a primary checkout. */
function isTaskWorktree(dir: string | undefined): dir is string {
  return !!dir && /[\\/]\.worktrees[\\/][^\\/]+[\\/]?$/.test(dir);
}

/**
 * Schedule the post-exit reap of an agent CLI.
 *
 * @param pid - The exited CLI's PID / 終了した CLI の PID
 * @param workDir - Directory the CLI ran in / CLI の作業ディレクトリ
 * @param deps - Side effects / 副作用
 */
export function scheduleAgentReap(
  pid: number,
  workDir: string | undefined,
  deps: ReapDeps = liveDeps,
): void {
  // Capture NOW, while parent links are still live — a command the agent
  // launched can outlive both the agent and the shell that started it.
  const known = deps.capture(pid);
  const workdir = isTaskWorktree(workDir) ? workDir : undefined;
  deps.schedule(() => {
    deps.kill(pid, { knownTargets: known, ...(workdir ? { workdir } : {}) });
  });
}
