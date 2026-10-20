/**
 * AssistantCapabilities
 *
 * The single declaration of what ラピ is allowed to do.
 *
 * ラピ does not get to call the REST API freely. Every operation it can
 * perform is one entry here, and an entry says what it costs to be wrong:
 * whether it changes data, whether a human has to confirm it first, and what
 * undoing it takes. The audit log keys off these ids and refuses any that is
 * not declared, so a capability cannot quietly come into existence.
 *
 * Not responsible for performing anything — see the routes under
 * `routes/ai/assistant-intake.routes.ts`.
 */

/** Every operation ラピ may perform. Adding one means adding it here first. */
export const ASSISTANT_CAPABILITIES = [
  {
    id: 'task.draft',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    id: 'task.create',
    writes: true,
    requiresConfirmation: true,
    undo: 'delete-what-was-made',
  },
  {
    // Lists what a set of conditions matches. The model-driven proposal can
    // only weigh a window of sixty; on a theme with 719 tasks that is not a
    // worse answer than a filter, it is the wrong instrument. Reads only.
    id: 'task.delete-filter',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    // Reads tasks and suggests which to remove. It writes nothing, so it
    // needs no confirmation — but what it suggests feeds a capability that
    // does, which is the whole reason the two are separate entries.
    id: 'task.delete-draft',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    // Only declarable because the trash exists. Before it, a deletion
    // cascaded across 43 relations with nothing kept, and this entry would
    // have had to say 'not-yet-possible' — which the roadmap (#1119) treats
    // as a reason not to ship the capability at all.
    id: 'task.delete',
    writes: true,
    requiresConfirmation: true,
    undo: 'restore-from-trash',
  },
] as const satisfies readonly AssistantCapability[];

/** What undoing a capability takes. */
export type UndoCost =
  /** It changed nothing. */
  | 'nothing-to-undo'
  /** Reversed by deleting what it produced. */
  | 'delete-what-was-made'
  /** Reversed by restoring the copy taken before the delete. */
  | 'restore-from-trash'
  /** Cannot currently be undone — nothing may be declared this way without
      the roadmap (#1119) saying why, because it means a mistake is permanent. */
  | 'not-yet-possible';

/** One declared operation. */
export interface AssistantCapability {
  /** Stable, dotted, lower-case. Recorded in the audit log, so it outlives code. */
  id: string;
  /** Whether running it changes data. */
  writes: boolean;
  /** Whether the caller must carry an explicit confirmation from the user. */
  requiresConfirmation: boolean;
  undo: UndoCost;
}

/** The id of a declared capability. */
export type AssistantCapabilityId = (typeof ASSISTANT_CAPABILITIES)[number]['id'];

/** Raised when something reaches for a capability nobody declared. */
export class UnknownCapabilityError extends Error {
  constructor(id: string) {
    super(`Unknown assistant capability: ${id}`);
    this.name = 'UnknownCapabilityError';
  }
}

/** Raised when a capability that needs confirming was asked to run without it. */
export class ConfirmationRequiredError extends Error {
  constructor(id: string) {
    super(`Assistant capability requires confirmation: ${id}`);
    this.name = 'ConfirmationRequiredError';
  }
}

/**
 * Whether an arbitrary string names a declared capability.
 *
 * @param id - The candidate id / 判定するID
 * @returns True when it is declared / 宣言済みなら true
 */
export function isCapabilityId(id: string): id is AssistantCapabilityId {
  return ASSISTANT_CAPABILITIES.some((capability) => capability.id === id);
}

/**
 * Look up a declaration.
 *
 * @param id - The capability id / 能力ID
 * @returns Its declaration / その宣言
 * @throws {UnknownCapabilityError} When it is not declared / 未宣言の場合
 */
export function getCapability(id: AssistantCapabilityId): AssistantCapability {
  const found = ASSISTANT_CAPABILITIES.find((capability) => capability.id === id);
  if (!found) throw new UnknownCapabilityError(id);
  return found;
}

/**
 * Check a capability may run as asked, before it runs.
 *
 * @param id - The capability id / 能力ID
 * @param context - Whether the user confirmed this particular act / ユーザーが明示承認したか
 * @throws {UnknownCapabilityError} When it is not declared / 未宣言の場合
 * @throws {ConfirmationRequiredError} When it needs confirming and was not / 承認が必要なのに無い場合
 */
export function assertCapabilityAllowed(
  id: AssistantCapabilityId,
  context: { confirmed: boolean },
): void {
  const capability = getCapability(id);
  if (capability.requiresConfirmation && !context.confirmed) {
    throw new ConfirmationRequiredError(id);
  }
}
