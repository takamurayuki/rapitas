/**
 * stall-recovery-handlers
 *
 * Request handlers for the stall-recovery API: validate inputs, then delegate
 * to stall-recovery-service. No business logic and no route definitions here.
 */
import { ValidationError } from '../../../middleware/error-handler';
import { recoverStalledTask, scanStalledTasks } from './stall-recovery-service';
import type {
  RecoverResult,
  StallCheckResponse,
  StallRecoveryAction,
  StallVerbosity,
} from './stall-recovery.types';

const VALID_VERBOSITIES: readonly StallVerbosity[] = ['concise', 'standard', 'detailed'];
const VALID_ACTIONS: readonly StallRecoveryAction[] = [
  'resume',
  'interrupt',
  'requeue',
  'clear_git_lock',
];

/**
 * Handles GET /workflow/stall-check.
 *
 * @param query.verbosity - Optional narration detail level. / 読み上げ詳細度
 * @returns Stalled task reports. / 停滞タスク一覧
 * @throws {ValidationError} On an unknown verbosity value. / 不正な詳細度の場合
 */
export async function handleStallCheck(query: {
  verbosity?: string;
}): Promise<StallCheckResponse> {
  const verbosity = query.verbosity ?? 'standard';
  if (!VALID_VERBOSITIES.includes(verbosity as StallVerbosity)) {
    throw new ValidationError(
      `verbosity must be one of: ${VALID_VERBOSITIES.join(', ')}`,
    );
  }
  return scanStalledTasks(Date.now(), verbosity as StallVerbosity);
}

/**
 * Handles POST /workflow/tasks/:taskId/recover.
 *
 * @param params.taskId - Target task id (string from the path). / 対象タスクID
 * @param body.action - Approved recovery action. / 承認済みアクション
 * @returns Recovery outcome. / 実行結果
 * @throws {ValidationError} On an invalid taskId or unknown action. / 不正入力の場合
 */
export async function handleRecover(
  params: { taskId: string },
  body: { action?: string },
): Promise<RecoverResult> {
  const taskId = parseInt(params.taskId, 10);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new ValidationError('taskId must be a positive integer');
  }
  const action = body?.action;
  if (!action || !VALID_ACTIONS.includes(action as StallRecoveryAction)) {
    throw new ValidationError(`action must be one of: ${VALID_ACTIONS.join(', ')}`);
  }
  return recoverStalledTask(taskId, action as StallRecoveryAction);
}
