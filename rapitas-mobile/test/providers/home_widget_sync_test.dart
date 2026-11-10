import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/connection_provider.dart';
import 'package:rapitas_mobile/providers/home_widget_sync_provider.dart';
import 'package:rapitas_mobile/services/home_screen_bridge.dart';

/// ホーム画面ウィジェットのスナップショット（design.md §3.2）の組み立てと、書き出しの間引き

class _FakeBridge implements HomeScreenBridge {
  final List<Map<String, Object?>> written = [];

  @override
  bool get isSupported => true;

  @override
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot) async => written.add(snapshot);

  @override
  Future<List<PendingRapiRequest>> takePendingRequests() async => const [];
}

final _created = DateTime(2026, 11, 1);

Task _task(String id, String title, {DateTime? due, String status = 'todo', List<Task>? subtasks}) =>
    Task(
      id: id,
      title: title,
      status: status,
      dueDate: due,
      createdAt: _created,
      updatedAt: _created,
      subtasks: subtasks,
    );

ApprovalRequest _approval(String id) =>
    ApprovalRequest(id: id, title: '承認 $id', createdAt: _created);

ExecutingTask _exec(String taskId, {String status = 'running', DateTime? startedAt}) => ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      executionStatus: status,
      startedAt: startedAt,
    );

const _paired = ConnectionSettings(
  baseUrl: 'http://192.168.1.5:3001',
  apiToken: 'secret-token',
  desktopId: 'd1',
  desktopName: 'Yuki-PC',
  loaded: true,
);

// 2026-11-11 09:30（端末のローカル時刻）
final _now = DateTime(2026, 11, 11, 9, 30);

Map<String, Object?>? _build({
  ConnectionSettings settings = _paired,
  AsyncValue<List<ApprovalRequest>>? approvals,
  AsyncValue<List<ExecutingTask>>? executing,
  AsyncValue<List<Task>>? tasks,
  Map<String, Object?>? previous,
  DateTime? now,
}) =>
    buildWidgetSnapshot(
      now: now ?? _now,
      settings: settings,
      approvals: approvals ?? const AsyncData([]),
      executing: executing ?? const AsyncData([]),
      tasks: tasks ?? const AsyncData([]),
      previous: previous,
    );

void main() {
  group('今日のタスク', () {
    test('期限が今日・期限切れの未完了だけを、サブタスクも含めて期限の早い順に数える', () {
      final tasks = [
        _task('1', '今日の親', due: DateTime(2026, 11, 11, 18), subtasks: [
          _task('2', '昨日のサブタスク', due: DateTime(2026, 11, 10)),
          _task('3', '今日の完了済み', due: DateTime(2026, 11, 11), status: 'done'),
        ]),
        _task('4', '明日', due: DateTime(2026, 11, 12)),
        _task('5', '期限なし'),
        _task('6', '先週の中止', due: DateTime(2026, 11, 4), status: 'cancelled'),
        _task('7', '今朝', due: DateTime(2026, 11, 11, 8)),
      ];
      final today = widgetTodayTasks(tasks, _now);
      expect(today.tasks.map((t) => t.title), ['昨日のサブタスク', '今朝', '今日の親']);
      expect(today.overdue, 1);

      final snapshot = _build(tasks: AsyncData(tasks))!;
      expect(snapshot['today'], {
        'count': 3,
        'overdue': 1,
        'titles': ['昨日のサブタスク', '今朝'],
      });
    });

    test('UTC で届いた期限も端末のローカル日付で判定する', () {
      // 端末のタイムゾーンに関係なく「ローカルで今日の正午」を UTC にしたもの
      final dueUtc = DateTime(2026, 11, 11, 12).toUtc();
      final today = widgetTodayTasks([_task('1', 'a', due: dueUtc)], _now);
      expect(today.tasks, hasLength(1));
      expect(today.overdue, 0);
    });
  });

  group('スナップショット', () {
    test('件数・実行中の1件（入力待ちを優先し、名前はタスク一覧から引く）を組み立てる', () {
      final snapshot = _build(
        approvals: AsyncData([_approval('a1'), _approval('a2')]),
        executing: AsyncData([
          _exec('10', startedAt: DateTime.utc(2026, 11, 11, 0, 20)),
          _exec('20', status: 'waiting_for_input', startedAt: DateTime.utc(2026, 11, 11, 0, 10)),
        ]),
        tasks: AsyncData([
          _task('10', '新しいほう'),
          _task('1', '親', subtasks: [_task('20', '入力待ちのサブタスク')]),
        ]),
      )!;
      expect(snapshot['v'], 1);
      expect(snapshot['connection'], 'ok');
      expect(snapshot['desktopName'], 'Yuki-PC');
      expect(snapshot['updatedAt'], _now.toUtc().toIso8601String());
      expect(snapshot['approvals'], {'count': 2});
      expect(snapshot['executing'], {
        'count': 2,
        'top': {
          'taskId': '20',
          'title': '入力待ちのサブタスク',
          'status': 'waiting_for_input',
          'startedAt': '2026-11-11T00:10:00.000Z',
        },
      });
    });

    test('トークンも接続先の URL も入れない', () {
      final snapshot = _build()!;
      final text = snapshot.toString();
      expect(text, isNot(contains('secret-token')));
      expect(text, isNot(contains('192.168.1.5')));
    });

    test('名前が引けない実行中タスクは「タスク #id」にする', () {
      final snapshot = _build(executing: AsyncData([_exec('99')]))!;
      expect((snapshot['executing'] as Map)['top'], containsPair('title', 'タスク #99'));
    });

    test('未ペアリング（トークンなし・接続先が localhost）なら unpaired だけを書く', () {
      final snapshot = _build(settings: const ConnectionSettings(baseUrl: 'http://localhost:3001', loaded: true))!;
      expect(snapshot.keys, unorderedEquals(['v', 'updatedAt', 'connection']));
      expect(snapshot['connection'], 'unpaired');
    });

    test('接続設定を読み込む前と、一覧の読み込み中は書かない', () {
      expect(_build(settings: const ConnectionSettings(baseUrl: 'http://localhost:3001')), isNull);
      expect(_build(tasks: const AsyncLoading()), isNull);
    });

    test('取得に失敗した一覧は前回の値を残し、error の印と前回の時刻を付ける', () {
      final previous = _build(
        approvals: AsyncData([_approval('a1')]),
        tasks: AsyncData([_task('1', '今日', due: DateTime(2026, 11, 11))]),
      )!;
      final later = _now.add(const Duration(minutes: 20));
      final failed = _build(
        now: later,
        approvals: AsyncError(Exception('offline'), StackTrace.empty),
        tasks: AsyncError(Exception('offline'), StackTrace.empty),
        previous: previous,
      )!;
      expect(failed['connection'], 'error');
      expect(failed['approvals'], {'count': 1});
      expect(failed['today'], previous['today']);
      expect(failed['updatedAt'], previous['updatedAt']);
    });

    test('一度も取れないまま失敗しても、0件の error として書く（未接続と分かるように）', () {
      final snapshot = _build(approvals: AsyncError(Exception('offline'), StackTrace.empty))!;
      expect(snapshot['connection'], 'error');
      expect(snapshot['approvals'], {'count': 0});
    });
  });

  group('書き出しの間引き', () {
    late _FakeBridge bridge;
    late DateTime clock;
    late Map<String, Object?>? Function(Map<String, Object?>?) build;

    HomeWidgetSync sync() => HomeWidgetSync(
          bridge: bridge,
          build: (previous) => build(previous),
          now: () => clock,
          debounce: const Duration(milliseconds: 10),
        );

    setUp(() {
      bridge = _FakeBridge();
      clock = _now;
      build = (previous) => _build(now: clock, approvals: AsyncData([_approval('a1')]), previous: previous);
    });

    test('中身が前回と同じなら書かない。変わったら書く', () async {
      final s = sync();
      await s.flushNow();
      clock = clock.add(const Duration(minutes: 1));
      await s.flushNow();
      expect(bridge.written, hasLength(1));

      build = (previous) =>
          _build(now: clock, approvals: AsyncData([_approval('a1'), _approval('a2')]), previous: previous);
      await s.flushNow();
      expect(bridge.written, hasLength(2));
      expect(bridge.written.last['approvals'], {'count': 2});
    });

    test('中身が同じでも、間隔を過ぎたら書き直して時刻を新しくする', () async {
      final s = sync();
      await s.flushNow();
      clock = clock.add(widgetRefreshInterval);
      await s.flushNow();
      expect(bridge.written, hasLength(2));
      expect(bridge.written.last['updatedAt'], clock.toUtc().toIso8601String());
    });

    test('続けて届いた変化はまとめて1回だけ書く', () async {
      final s = sync();
      s.schedule();
      s.schedule();
      s.schedule();
      expect(bridge.written, isEmpty);
      await Future<void>.delayed(const Duration(milliseconds: 40));
      expect(bridge.written, hasLength(1));
      s.dispose();
    });
  });
}
