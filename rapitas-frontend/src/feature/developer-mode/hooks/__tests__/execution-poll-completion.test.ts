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

describe('isPhaseAutoAdvancing — 質問待ちは前進扱いしない', () => {
  // 自動実行を停止して全エージェントを止めた後でも、質問を出して正常終了した
  // 実行行(completed)+ in-progress のタスクをタスク詳細で開くと「実行中」として
  // ストアに再登録され、カードの経過タイマーとローダーが復活した実測不具合の回帰テスト。
  // 質問待ちは人が答えるまで何も進まないので、フェーズ境界ではない。
  it('workflowStatus=awaiting_question かつ実行が completed なら前進扱いしない (in-progress)', () => {
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'in-progress',
        workflowStatus: 'awaiting_question',
        sessionMode: 'workflow-implementer',
        sessionStatus: 'completed',
        waitingForInput: false,
      }),
    ).toBe(false);
  });

  it('workflowStatus=awaiting_question なら sessionMode が自動前進フェーズでも前進扱いしない (todo)', () => {
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'todo',
        workflowStatus: 'awaiting_question',
        sessionMode: 'workflow-researcher',
        sessionStatus: 'completed',
      }),
    ).toBe(false);
  });

  it('質問がまだ生きている(waitingForInput=true)場合はこの除外の対象外', () => {
    // waiting_for_input 分岐が扱うケース。completed ハンドラには来ないが、
    // 判定関数単体としては従来値を返すことを固定する。
    expect(
      isPhaseAutoAdvancing({
        taskStatus: 'in-progress',
        workflowStatus: 'awaiting_question',
        sessionMode: 'workflow-implementer',
        sessionStatus: 'running',
        waitingForInput: true,
      }),
    ).toBe(true);
  });

  it('shouldKeepPollingAfterCompleted も質問待ちでは停止する', () => {
    expect(
      shouldKeepPollingAfterCompleted({
        executionStatus: 'completed',
        taskStatus: 'in-progress',
        workflowStatus: 'awaiting_question',
        sessionMode: 'workflow-implementer',
        sessionStatus: 'completed',
      }),
    ).toBe(false);
  });
});
