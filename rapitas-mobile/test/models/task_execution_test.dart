import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';

void main() {
  group('ExecutingTask.fromJson', () {
    test('GET /tasks/executing の実ペイロード（数値ID・parentId null）を読む', () {
      final task = ExecutingTask.fromJson({
        'executionId': 2806,
        'sessionId': 412,
        'taskId': 658,
        'parentId': null,
        'executionStatus': 'running',
        'startedAt': '2026-11-08T01:23:45.000Z',
        'sessionStartedAt': '2026-11-08T01:00:00.000Z',
        'activeTimeMs': 120000,
      });

      expect(task.executionId, '2806');
      expect(task.sessionId, '412');
      expect(task.taskId, '658');
      expect(task.parentId, isNull);
      expect(task.executionStatus, 'running');
      expect(task.isWaitingForInput, isFalse);
      expect(task.startedAt, DateTime.utc(2026, 11, 8, 1, 23, 45));
      expect(task.sessionStartedAt, DateTime.utc(2026, 11, 8, 1));
      expect(task.activeTimeMs, 120000);
    });

    test('サブタスク実行（parentId あり）と入力待ち', () {
      final task = ExecutingTask.fromJson({
        'executionId': 3001,
        'sessionId': 500,
        'taskId': 701,
        'parentId': 700,
        'executionStatus': 'waiting_for_input',
        'startedAt': null,
        'sessionStartedAt': '2026-11-08T02:00:00.000Z',
        'activeTimeMs': 0,
      });

      expect(task.parentId, '700');
      expect(task.isWaitingForInput, isTrue);
      expect(task.startedAt, isNull);
      expect(task.activeTimeMs, 0);
    });
  });

  group('ResumableExecution.fromJson', () {
    test('中断実行（canResume: true、output は末尾文字列）を読む', () {
      final tail = 'x' * 480 + '\nError: process exited';
      final execution = ResumableExecution.fromJson({
        'id': 2806,
        'taskId': 658,
        'taskTitle': 'ログイン画面を直す',
        'sessionId': 412,
        'status': 'interrupted',
        'claudeSessionId': 'abc-123',
        'errorMessage': 'Server restarted',
        'output': tail,
        'startedAt': '2026-11-08T01:23:45.000Z',
        'completedAt': null,
        'createdAt': '2026-11-08T01:23:40.000Z',
        'workingDirectory': '/home/user/repo',
        'workflowStatus': 'in_progress',
        'workflowMode': null,
        'canResume': true,
      });

      expect(execution.id, '2806');
      expect(execution.taskId, '658');
      expect(execution.taskTitle, 'ログイン画面を直す');
      expect(execution.sessionId, '412');
      expect(execution.status, 'interrupted');
      expect(execution.canResume, isTrue);
      expect(execution.errorMessage, 'Server restarted');
      expect(execution.output, tail);
      expect(execution.output!.endsWith('Error: process exited'), isTrue);
      expect(execution.completedAt, isNull);
      expect(execution.createdAt, DateTime.utc(2026, 11, 8, 1, 23, 40));
      expect(execution.workflowStatus, 'in_progress');
      expect(execution.workflowMode, isNull);
    });

    test('実行中の行は canResume: false', () {
      final execution = ResumableExecution.fromJson({
        'id': 3001,
        'taskId': 701,
        'taskTitle': '別タスク',
        'sessionId': 500,
        'status': 'running',
        'claudeSessionId': null,
        'errorMessage': null,
        'output': null,
        'startedAt': '2026-11-08T02:00:00.000Z',
        'completedAt': null,
        'createdAt': '2026-11-08T02:00:00.000Z',
        'workingDirectory': null,
        'workflowStatus': null,
        'workflowMode': null,
        'canResume': false,
      });

      expect(execution.canResume, isFalse);
      expect(execution.output, isNull);
      expect(execution.errorMessage, isNull);
    });

    test('canResume が無い・タスクが外れている場合も落ちない', () {
      final execution = ResumableExecution.fromJson({
        'id': 9,
        'sessionId': 1,
        'status': 'interrupted',
      });

      expect(execution.canResume, isFalse);
      expect(execution.taskId, isNull);
      expect(execution.taskTitle, isNull);
    });
  });

  group('TaskExecutionStart.fromJson', () {
    test('通常の実行開始（数値の sessionId・taskId あり）', () {
      final start = TaskExecutionStart.fromJson(
        {
          'success': true,
          'message': 'Task execution started',
          'sessionId': 412,
          'taskId': 658,
        },
        taskId: '658',
      );

      expect(start.sessionId, '412');
      expect(start.taskId, '658');
      expect(start.message, 'Task execution started');
      expect(start.status, isNull);
      expect(start.isAwaitingQuestion, isFalse);
    });

    test('draft の質問作成（awaiting_question・sessionId も taskId も無い）', () {
      final start = TaskExecutionStart.fromJson(
        {
          'success': true,
          'status': 'awaiting_question',
          'workflowStatus': 'awaiting_question',
          'message': '仕様が不十分なため確認の質問を作成しました（回答されるまで先に進みません）',
        },
        taskId: '658',
      );

      expect(start.sessionId, isNull);
      // レスポンスに taskId が無いので、呼び出し側が渡した ID を使う
      expect(start.taskId, '658');
      expect(start.status, 'awaiting_question');
      expect(start.message, '仕様が不十分なため確認の質問を作成しました（回答されるまで先に進みません）');
      expect(start.isAwaitingQuestion, isTrue);
    });

    test('success: false はモデルでは判定しない（例外化は AgentService の責務）', () {
      // AgentService._postAction が success != true を AgentActionException に
      // 変換するので、失敗レスポンスがここまで来ることは通常ない。
      // モデル単体では落ちずに読め、実行開始・質問作成のどちらとも扱わないことだけ確かめる。
      final start = TaskExecutionStart.fromJson(
        {
          'success': false,
          'error': 'このテーマは自動実行モード中です。手動実行するには自動実行を停止してください。',
          'code': 'AUTO_RUN_ACTIVE',
        },
        taskId: '658',
      );

      expect(start.sessionId, isNull);
      expect(start.taskId, '658');
      expect(start.status, isNull);
      expect(start.isAwaitingQuestion, isFalse);
    });
  });
}
