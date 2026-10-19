/**
 * AssistantActionLog
 *
 * The record of what ラピ was asked to do and what came of it.
 *
 * Written for proposals as well as for acts, and for refusals as well as for
 * successes: "ラピ suggested deleting these and I said no" is exactly the
 * thing you want to be able to look up later, and it leaves no other trace.
 *
 * The capability id is checked against the registry before anything is
 * written, so the log cannot drift into recording operations nobody declared
 * — which is the only thing that keeps the registry honest as the surface
 * grows.
 *
 * Not responsible for deciding whether an act is allowed — see
 * `assertCapabilityAllowed`.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getCapability, type AssistantCapabilityId } from './capabilities';

const logger = createLogger('assistant-action-log');

/** How far an act got. */
export type AssistantActionStatus =
  /** ラピ worked something out and showed it; nothing was changed. */
  | 'proposed'
  /** It ran and did what it said. */
  | 'executed'
  /** It ran and did not. */
  | 'failed'
  /** It was not allowed to run — unconfirmed, or not declared. */
  | 'refused';

export interface RecordActionInput {
  capabilityId: AssistantCapabilityId;
  status: AssistantActionStatus;
  /** What it was asked to do. Stored as JSON text, like Notification.metadata. */
  args?: unknown;
  result?: unknown;
  errorMessage?: string;
  /** The task this act produced or concerned, when there is one. */
  taskId?: number;
}

/** Narrow a value to JSON text, or undefined when there is nothing to store. */
function toJsonText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular or otherwise unserialisable: the act still happened, and a
    // record missing its arguments beats no record at all.
    return undefined;
  }
}

/**
 * Write one row for an act ラピ took, proposed, or was refused.
 *
 * Never throws on a storage failure: losing the audit row must not turn a
 * successful act into a failed request, and the caller has already done the
 * thing by the time this runs. A failure is logged loudly instead.
 *
 * @param input - The capability, how far it got, and what it carried / 能力・結果・内容
 * @returns The new row's id, or null when it could not be stored / 記録ID（失敗時 null）
 * @throws {UnknownCapabilityError} When the capability is not declared / 未宣言の能力の場合
 */
export async function recordAction(input: RecordActionInput): Promise<number | null> {
  // Deliberately before the try: an undeclared capability is a programming
  // error in rapitas, not a storage hiccup, and it must not be swallowed.
  getCapability(input.capabilityId);

  try {
    const row = await prisma.assistantAction.create({
      data: {
        capabilityId: input.capabilityId,
        status: input.status,
        argumentsJson: toJsonText(input.args),
        resultJson: toJsonText(input.result),
        errorMessage: input.errorMessage,
        taskId: input.taskId,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    logger.error({ err, capabilityId: input.capabilityId }, 'failed to record an assistant action');
    return null;
  }
}

/** One row as the UI reads it back. */
export interface AssistantActionRecord {
  id: number;
  capabilityId: string;
  status: string;
  taskId: number | null;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * The most recent acts, newest first.
 *
 * @param limit - How many to return, capped / 取得件数（上限あり）
 * @returns The rows / 記録
 */
export async function listRecentActions(limit = 20): Promise<AssistantActionRecord[]> {
  return prisma.assistantAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      capabilityId: true,
      status: true,
      taskId: true,
      errorMessage: true,
      createdAt: true,
    },
  });
}
