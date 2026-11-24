/**
 * confirm-link-types
 *
 * Shared types of the confirm-link service (task 1430): injected
 * dependencies, page results and the issue error. Split out of
 * confirm-link-service.ts to keep that file under 300 lines.
 */
import type { ApplyQuestionAnswerByKindParams } from '../../../routes/workflow/handlers/workflow-handlers-resume-dispatch';
import type { ConfirmLinkAuditEntry } from './confirm-link-audit';
import type {
  ConfirmLinkResourceDeps,
  ConfirmLinkResourceOwner,
  PublicResourceView,
} from './confirm-link-resources';
import type { ConfirmLinkStore } from './confirm-link-store';

/** Task state the service re-checks before showing or applying. */
export interface ConfirmLinkTaskSnapshot {
  workflowStatus: string | null;
  latestPauseId: number | null;
}

/** Injected collaborators. */
export interface ConfirmLinkServiceDeps {
  store: ConfirmLinkStore;
  /** Null disables the feature. / 署名鍵（未設定なら無効） */
  secret: string | null;
  publicOrigin: string | null;
  readTaskSnapshot: (taskId: number) => Promise<ConfirmLinkTaskSnapshot | null>;
  readQuestion: (taskId: number) => Promise<string | null>;
  readResources: ConfirmLinkResourceDeps['readResources'];
  applyAnswer: (params: ApplyQuestionAnswerByKindParams) => Promise<{ kind: string }>;
  releaseHalt: (taskId: number, answer: string, label: string) => Promise<unknown>;
  triggerReExecution: (taskId: number) => Promise<void>;
  /** Written BEFORE the answer is applied; failing it refuses the answer. / 適用前に書く監査 */
  appendAudit: (entry: ConfirmLinkAuditEntry) => Promise<void>;
  /** Compensating delete once the answer is known not to be applied. / 補償削除 */
  removeAudit: (id: string) => Promise<void>;
  /** Drop the task's audit lines whose link is `active` or `revoked`. / 孤児の掃除 */
  pruneOrphanAudits: (taskId: number) => Promise<void>;
  /** Workspace-scoped resource lookup for the visibility toggle. / 資料の所属照合 */
  readResourceOwner: (resourceId: number) => Promise<ConfirmLinkResourceOwner | null>;
}

/** Thrown by {@link issueConfirmLink}; the route maps `status` to the response. */
export class ConfirmLinkError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConfirmLinkError';
  }
}

/** What the public form shows. */
export interface ConfirmLinkView {
  message: string;
  summary: string;
  options: Array<{ key: string; label: string; consequence?: string }>;
  resources: PublicResourceView[];
  expiresAt: number;
}

/** Outcome for the public routes. */
export type ConfirmLinkPageResult =
  | { status: 200 | 400; kind: 'form'; view: ConfirmLinkView; error?: string }
  | { status: 200; kind: 'answered'; selectedLabel: string }
  | { status: 404; kind: 'not_found' }
  | { status: 409 | 410; kind: 'gone' }
  | { status: 500; kind: 'error'; uncertain?: boolean }
  | { status: 503; kind: 'unavailable' };
