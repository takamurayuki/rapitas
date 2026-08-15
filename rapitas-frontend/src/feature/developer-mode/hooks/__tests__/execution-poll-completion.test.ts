/**
 * execution-poll-completion テスト
 *
 * 'blocked' が終端タスクステータスとして扱われることの回帰テスト。完了ゲートに
 * 差し戻された(status='blocked')タスクは次フェーズが存在しないため、
 * オートアドバンス系フェーズの直後であってもポーリングを継続してはいけない。
 */
import {
  shouldKeepPollingAfterCompleted,
  isPhaseAutoAdvancing,
} from '../execution-poll-completion';

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

describe('isPhaseAutoAdvancing — 死んだセッションは前進扱いしない (task 585)', () => {
  // タスク詳細ページを開くと、失敗した researcher セッションが
  // AUTO_ADVANCING_PHASES に含まれるだけで「実行中」として再登録され、
  // 存在しないエージェントの経過タイマーが動き出した実測不具合の回帰テスト。
  it.each(['failed', 'cancelled', 'interrupted', 'reset'])(
    'sessionStatus=%s なら次フェーズは来ないと判定する',
    (sessionStatus) => {
      expect(
        isPhaseAutoAdvancing({
          taskStatus: 'todo',
          workflowStatus: 'draft',
          sessionMode: 'workflow-researcher',
          sessionStatus,
        }),
      ).toBe(false);
    },
  );

  it('通常のフェーズ境界(sessionStatus=completed)では従来どおり前進扱いする', () => {
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'in-progress',
        workflowStatus: 'research_done',
        sessionMode: 'workflow-researcher',
        sessionStatus: 'completed',
      }),
    ).toBe(true);
  });

  it('sessionStatus が無い(古いバックエンド)場合は従来判定を維持する', () => {
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'in-progress',
        workflowStatus: 'research_done',
        sessionMode: 'workflow-researcher',
      }),
    ).toBe(true);
  });

  it('セッションが生きていてもワークフローが終端なら前進扱いしない', () => {
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'done',
        workflowStatus: 'completed',
        sessionMode: 'workflow-verifier',
        sessionStatus: 'completed',
      }),
    ).toBe(false);
  });
});
