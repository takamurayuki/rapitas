/**
 * execution/session-mode
 *
 * Reads and writes AgentSession.mode (`workflow-<role>` for a workflow phase
 * run) for the execution routes. The mode tells the completion writes a
 * workflow phase from a single run, so a read failure is reported as unknown
 * and a write failure is reported to the caller instead of being swallowed.
 */
import { prisma } from '../../../../config/database';
import { createLogger } from '../../../../config/logger';

const log = createLogger('routes:agent-execution:session-mode');

const TAG_ATTEMPTS = 2;

/**
 * Read a session's mode, keeping a failed read apart from a null mode.
 *
 * @param sessionId - Session to read / 対象セッションID
 * @returns The mode (null when unset), or undefined when the read failed or the row is missing / mode（未設定は null、読めない・行なしは undefined）
 */
export async function readSessionMode(sessionId: number): Promise<string | null | undefined> {
  try {
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: { mode: true },
    });
    return session ? session.mode : undefined;
  } catch (err) {
    log.warn({ err, sessionId }, '[session-mode] Could not read session mode');
    return undefined;
  }
}

/**
 * Tag a session with its workflow role (`workflow-<role>`), retrying once.
 *
 * @param sessionId - Session to tag / 対象セッションID
 * @param role - Workflow role of the run (researcher, implementer, ...) / ワークフローの役割
 * @returns True when the mode was saved / 保存できた場合 true
 */
export async function tagSessionWorkflowRole(sessionId: number, role: string): Promise<boolean> {
  for (let attempt = 1; attempt <= TAG_ATTEMPTS; attempt++) {
    try {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: { mode: `workflow-${role}` },
      });
      return true;
    } catch (err) {
      log.warn({ err, sessionId, role, attempt }, '[session-mode] Failed to set session mode');
    }
  }
  return false;
}
