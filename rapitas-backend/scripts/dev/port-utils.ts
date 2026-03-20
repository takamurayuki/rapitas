/**
 * Port Utilities
 *
 * Cross-platform helpers for killing processes that hold a TCP port.
 * Used by dev-server.ts during startup to clear zombie processes.
 */
import { spawnSync } from 'bun';
import { createLogger } from '../../config/logger';

const pinoLog = createLogger('dev');

const log = {
  info: (msg: string) => pinoLog.info(msg),
  success: (msg: string) => pinoLog.info(msg),
  warn: (msg: string) => pinoLog.warn(msg),
  error: (msg: string) => pinoLog.error(msg),
};

/**
 * Kills all processes listening on the specified TCP port.
 * Uses `netstat`+`taskkill` on Windows, `lsof`+`kill` on POSIX.
 *
 * @param port - Port number to clear / クリアするポート番号
 */
export async function killProcessesOnPort(port: number): Promise<void> {
  const isWindows = process.platform === 'win32';

  try {
    if (isWindows) {
      const netstatResult = spawnSync({
        cmd: ['netstat', '-ano'],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = new TextDecoder().decode(netstatResult.stdout as unknown as ArrayBuffer);
      const lines = output.split('\n');
      const pids = new Set<number>();

      for (const line of lines) {
        if (
          line.includes(`:${port}`) &&
          (line.includes('LISTENING') ||
            line.includes('ESTABLISHED') ||
            line.includes('TIME_WAIT') ||
            line.includes('CLOSE_WAIT'))
        ) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid && pid > 0 && pid !== process.pid) {
            pids.add(pid);
          }
        }
      }

      for (const pid of pids) {
        log.info(`Killing process on port ${port} (PID: ${pid})...`);
        try {
          const killResult = spawnSync({
            cmd: ['taskkill', '/PID', pid.toString(), '/T'],
            stdout: 'pipe',
            stderr: 'pipe',
          });

          // Force kill if graceful termination failed
          if (killResult.exitCode !== 0) {
            spawnSync({
              cmd: ['taskkill', '/PID', pid.toString(), '/T', '/F'],
              stdout: 'pipe',
              stderr: 'pipe',
            });
          }
          log.success(`Process (PID: ${pid}) terminated`);
        } catch {
          // Process already exited
        }
      }

      if (pids.size > 0) {
        // Wait for port to be released
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } else {
      // Linux/macOS: lsof + kill
      const lsofResult = spawnSync({
        cmd: ['lsof', '-t', `-i:${port}`],
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const output = new TextDecoder().decode(lsofResult.stdout as unknown as ArrayBuffer).trim();
      if (output) {
        const pids = output
          .split('\n')
          .map((p) => parseInt(p, 10))
          .filter((p) => p > 0 && p !== process.pid);

        for (const pid of pids) {
          log.info(`Killing process on port ${port} (PID: ${pid})...`);
          try {
            spawnSync({
              cmd: ['kill', '-15', pid.toString()],
              stdout: 'pipe',
              stderr: 'pipe',
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
            // Force kill if still alive
            spawnSync({
              cmd: ['kill', '-9', pid.toString()],
              stdout: 'pipe',
              stderr: 'pipe',
            });
            log.success(`Process (PID: ${pid}) terminated`);
          } catch {
            // Process already exited
          }
        }

        if (pids.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  } catch (error) {
    log.warn(`Error during port cleanup: ${error}`);
  }
}
