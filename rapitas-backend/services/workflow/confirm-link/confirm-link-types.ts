/**
 * confirm-link-types
 *
 * Shared types of the confirm-link service (task 1430): injected
 * dependencies, page results and the issue error. Split out of
 * confirm-link-service.ts to keep that file under 300 lines.
 */
import type { ApplyQuestionAnswerByKindParams } from '../../../routes/workflow/handlers/workflow-handlers-resume-dispatch';
import type { ConfirmLinkAuditEntry } from './confirm-link-audit';
import type { ConfirmLinkResourceDeps, PublicResourceView } from './confirm-link-resources';
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
  appendAudit: (entry: ConfirmLinkAuditEntry) => Promise<void>;
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
  | { status: 500; kind: 'error' };
