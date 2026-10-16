/**
 * plan-for-verify
 *
 * Single place where the verify gate's three call paths fetch plan.md so
 * validateVerify can honour the plan's declared scope reductions. Fails open:
 * any lookup problem yields undefined, i.e. the legacy verdict.
 */
import { createLogger } from '../../config/logger';
import { readWorkflowFile } from './workflow-file-utils';

const log = createLogger('plan-for-verify');

export interface PlanLoadOptions {
  /** Plan reader (injected in tests). / plan 読み取り関数（テスト用に差し替え可） */
  loader?: (taskId: number) => Promise<string | null>;
  /** Warning sink (injected in tests). / 警告出力（テスト用に差し替え可） */
  warn?: (message: string, err: unknown) => void;
}

/**
 * Load plan.md for a task, never throwing.
 *
 * @param taskId - Task whose plan to load / 対象タスクID
 * @param options - Test seams / テスト用差し替え
 * @returns Plan body, or undefined when absent or unreadable / plan 本文、無い・読めない場合は undefined
 */
export async function loadPlanContentForVerify(
  taskId: number,
  options: PlanLoadOptions = {},
): Promise<string | undefined> {
  const loader = options.loader ?? ((id: number) => readWorkflowFile(id, 'plan'));
  const warn =
    options.warn ?? ((message: string, err: unknown) => log.warn({ err, taskId }, message));
  try {
    return (await loader(taskId)) ?? undefined;
  } catch (err) {
    warn('plan lookup failed; verify falls back to the legacy verdict', err);
    return undefined;
  }
}
