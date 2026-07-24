/**
 * execution-poll-completion テスト
 *
 * 'blocked' が終端タスクステータスとして扱われることの回帰テスト。完了ゲートに
 * 差し戻された(status='blocked')タスクは次フェーズが存在しないため、
 * オートアドバンス系フェーズの直後であってもポーリングを継続してはいけない。
 */
import { shouldKeepPollingAfterCompleted } from '../execution-poll-completion';

describe('shouldKeepPollingAfterCompleted', () => {
  it('stops polling once the task is blocked, even right after an auto-advancing phase', () => {
    const result = shouldKeepPollingAfterCompleted({
      taskStatus: 'blocked',
      workflowStatus: 'plan_approved',
      sessionMode: 'workflow-implementer',
    });
    expect(result).toBe(false);
  });

  it('keeps polling for an auto-advancing phase when the task is still in-progress', () => {
    const result = shouldKeepPollingAfterCompleted({
      taskStatus: 'in-progress',
      workflowStatus: 'plan_approved',
      sessionMode: 'workflow-implementer',
    });
    expect(result).toBe(true);
  });

  it('stops polling once the task reaches done, regardless of sessionMode', () => {
    const result = shouldKeepPollingAfterCompleted({
      taskStatus: 'done',
      workflowStatus: 'completed',
      sessionMode: 'workflow-verifier',
    });
    expect(result).toBe(false);
  });

  it('keeps polling when the task is actively progressing through a self-repair bounce', () => {
    const result = shouldKeepPollingAfterCompleted({
      taskStatus: 'in-progress',
      workflowStatus: 'in_progress',
      sessionMode: 'workflow-verifier',
    });
    expect(result).toBe(true);
  });
});
