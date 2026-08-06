/**
 * execution-owner
 *
 * Identity of THIS process instance as an execution owner. AgentExecution rows
 * are stamped with this id so death detection and stop-routing can reason
 * about "which process was running this" without cross-process IPC — the core
 * primitive the architecture review found missing (run ownership existed only
 * in two processes' in-memory maps).
 */
import { randomBytes } from 'crypto';

// AGENT_WORKER=1 is set by agent-worker/lifecycle.ts when spawning the worker.
const roleHint = process.env.AGENT_WORKER === '1' ? 'worker' : 'main';

/**
 * Stable-for-process-lifetime owner id. A new id per process start is the
 * point: rows stamped by a previous incarnation fail the lease check naturally.
 */
export const EXECUTION_OWNER_ID = `${roleHint}-${process.pid}-${randomBytes(3).toString('hex')}`;
