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
    // Answers questions about the backlog. The model turns the question into
    // a query and never into an answer, so every number comes from the
    // database — ラピ can be asked the wrong thing, but not be confidently
    // wrong about how many there are.
    id: 'task.query',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
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
  {
    // The first step of giving ラピ a supervisor's job, and deliberately the
    // only one for now: reading. Her judgement about what needs a hand is
    // unproven, and read-only is the only way to find out whether it is any
    // good — if she flags twenty and two get acted on, the conditions are
    // wrong, not the permissions. Acting on what she finds would also have
    // to settle who wins when the existing watchers disagree with her, which
    // is a decision this entry does not need to make.
    id: 'task.supervise',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    // Picks which of her destinations a sentence means. Safe to let a model
    // decide precisely because every destination is itself a read: the two
    // that can change anything ask for confirmation after you arrive. So a
    // wrong turn costs a wasted read, and the router is allowed to refuse —
    // the tabs still work.
    id: 'assistant.route',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    // Turns "I want to do X" into a plan: where it belongs, what it breaks
    // into, and what she still needs told. Writes nothing, which is what
    // lets a model shape the whole thing — every part is read before the
    // commit below creates any of it.
    id: 'roadmap.draft',
    writes: false,
    requiresConfirmation: false,
    undo: 'nothing-to-undo',
  },
  {
    // Creates the theme, project and tasks the user approved. No model runs
    // in this half: what is created is exactly what was on screen. Undoing
    // means removing what was made — the tasks go to the trash, but a theme
    // or project created here does not, which is why the plan shows what it
    // intends to create before this runs.
    id: 'roadmap.commit',
    writes: true,
    requiresConfirmation: true,
    undo: 'delete-what-was-made',
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
