import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/api_config.dart';
import '../models/approval_request.dart';
import '../models/task.dart';
import '../models/task_execution.dart';
import '../services/home_screen_bridge.dart';
import 'approval_provider.dart';
import 'connection_provider.dart';
import 'execution_provider.dart';
import 'task_provider.dart';

// ホーム画面ウィジェットへのスナップショットの書き出し。
//
// ウィジェット拡張はトークンを持たず、自分ではデータを取りに行かない。アプリが読み込んだ
// 承認待ち・実行中・今日のタスクから表示用の値だけを組み立て、App Group の共有 UserDefaults に書く
// （HomeScreenBridge 経由。キーは rapiWidgetSnapshot.v1、形は ios/Shared/RapiShared.swift と揃える）。
//
// - 3つの一覧は realtimeRefreshProvider が SSE のイベントで読み直すので、前面にいる間は自然に新しくなる
// - 1秒まとめてから書く。中身（updatedAt 以外）が前回と同じなら書かない
// - アプリが裏へ回る直前（paused）にも最新の値を書く（app_home_screen_provider.dart から [flushNow]）
// NOTE: タスク名はホーム画面に出る（design.md §9 の確認事項。推奨どおり、そのまま出す）。

/// スナップショットの版。ウィジェット側（RapiShared.swift）と揃える
const int widgetSnapshotVersion = 1;

/// 「今日」に出すタスク名の最大件数
const int widgetTodayTitleLimit = 2;

/// 中身が同じでも、この間隔を過ぎたら書き直して updatedAt を新しくする
/// （ウィジェットは updatedAt から30分で「HH:MM 時点」と出すため、変化がないだけで古く見せない）
const Duration widgetRefreshInterval = Duration(minutes: 15);

/// 1件の一覧を、取得できた値・失敗・読み込み中のどれかとして渡す
typedef _Section<T> = ({List<T>? value, bool failed});

_Section<T> _section<T>(AsyncValue<List<T>> value) =>
    (value: value.valueOrNull, failed: value.hasError);

/// 未ペアリングか（トークンがなく、接続先が既定の localhost のまま）
bool isWidgetUnpaired(ConnectionSettings settings) =>
    !settings.hasToken && settings.baseUrl == ApiConfig.defaultBaseUrl;

/// サブタスクも含めて、id の重複なしに並べる（GET /tasks は親タスクだけで、子は subtasks に入る）
List<Task> _flatten(List<Task> tasks) {
  final seen = <String>{};
  final out = <Task>[];
  void add(List<Task>? list) {
    if (list == null) return;
    for (final task in list) {
      if (seen.add(task.id)) out.add(task);
      add(task.subtasks);
    }
  }

  add(tasks);
  return out;
}

const Set<String> _closedStatuses = {'done', 'cancelled'};

DateTime _day(DateTime t) {
  final local = t.toLocal();
  return DateTime(local.year, local.month, local.day);
}

/// 「今日」のタスク：端末のローカル日付で期限が今日以前（期限切れも含む）で、未完了のもの。
/// 期限の早い順（同じなら id 順）
///
/// @param tasks - GET /tasks の一覧 / サブタスクは入れ子のまま
/// @param now - 現在時刻 / 「今日」の基準
/// @returns 該当タスクと、そのうち期限切れの件数
({List<Task> tasks, int overdue}) widgetTodayTasks(List<Task> tasks, DateTime now) {
  final today = _day(now);
  final due = _flatten(tasks)
      .where((t) => t.dueDate != null && !_closedStatuses.contains(t.status))
      .where((t) => !_day(t.dueDate!).isAfter(today))
      .toList()
    ..sort((a, b) {
      final byDue = a.dueDate!.compareTo(b.dueDate!);
      return byDue != 0 ? byDue : a.id.compareTo(b.id);
    });
  final overdue = due.where((t) => _day(t.dueDate!).isBefore(today)).length;
  return (tasks: due, overdue: overdue);
}

/// 実行中の一覧から、ウィジェットに名前を出す1件：入力待ちを優先し、次に開始の新しいもの
ExecutingTask? widgetTopExecution(List<ExecutingTask> executing) {
  if (executing.isEmpty) return null;
  final sorted = [...executing]..sort((a, b) {
      if (a.isWaitingForInput != b.isWaitingForInput) return a.isWaitingForInput ? -1 : 1;
      final at = a.startedAt, bt = b.startedAt;
      if (at == null && bt == null) return 0;
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt.compareTo(at);
    });
  return sorted.first;
}

/// ウィジェットのスナップショットを組み立てる（純関数）。
///
/// 取得に失敗した一覧は前回のスナップショットの値を残し、connection を error にする。
/// どれかがまだ一度も取得できておらず、前回の値もなければ null（まだ書かない）。
///
/// @param now - 現在時刻 / updatedAt と「今日」の基準
/// @param settings - 接続設定 / 未ペアリングの判定とデスクトップ名
/// @param approvals - 承認待ちの一覧 / GET /approvals（既定で pending だけ）
/// @param executing - 実行中の一覧 / GET /tasks/executing
/// @param tasks - タスク一覧 / GET /tasks（フィルタなし）
/// @param previous - 前回書いたスナップショット / 失敗時に値を残すため
/// @returns スナップショット。まだ書けないなら null
Map<String, Object?>? buildWidgetSnapshot({
  required DateTime now,
  required ConnectionSettings settings,
  required AsyncValue<List<ApprovalRequest>> approvals,
  required AsyncValue<List<ExecutingTask>> executing,
  required AsyncValue<List<Task>> tasks,
  Map<String, Object?>? previous,
}) {
  if (!settings.loaded) return null;
  final stamp = now.toUtc().toIso8601String();
  if (isWidgetUnpaired(settings)) {
    return {'v': widgetSnapshotVersion, 'updatedAt': stamp, 'connection': 'unpaired'};
  }

  final a = _section(approvals);
  final e = _section(executing);
  final t = _section(tasks);
  final failed = a.failed || e.failed || t.failed;

  Map<String, Object?>? approvalsPart;
  if (a.value case final list?) {
    approvalsPart = {'count': list.length};
  } else if (previous?['approvals'] case final Map<String, Object?> kept) {
    approvalsPart = kept;
  }

  Map<String, Object?>? executingPart;
  if (e.value case final list?) {
    final titles = _titles(t.value);
    final top = widgetTopExecution(list);
    executingPart = {
      'count': list.length,
      if (top != null)
        'top': {
          'taskId': top.taskId,
          'title': titles[top.taskId] ?? _keptTitle(previous, top.taskId) ?? 'タスク #${top.taskId}',
          'status': top.executionStatus,
          if (top.startedAt != null) 'startedAt': top.startedAt!.toUtc().toIso8601String(),
        },
    };
  } else if (previous?['executing'] case final Map<String, Object?> kept) {
    executingPart = kept;
  }

  Map<String, Object?>? todayPart;
  if (t.value case final list?) {
    final today = widgetTodayTasks(list, now);
    todayPart = {
      'count': today.tasks.length,
      'overdue': today.overdue,
      'titles': [for (final task in today.tasks.take(widgetTodayTitleLimit)) task.title],
    };
  } else if (previous?['today'] case final Map<String, Object?> kept) {
    todayPart = kept;
  }

  if (approvalsPart == null || executingPart == null || todayPart == null) {
    // 一度も取れていない一覧があり、読み込み中なら待つ。失敗なら、取れた分だけで「未接続」として出す
    if (!failed) return null;
  }

  return {
    'v': widgetSnapshotVersion,
    // 失敗したときは、値の鮮度が分かるよう前回の時刻を残す
    'updatedAt': failed ? (previous?['updatedAt'] as String? ?? stamp) : stamp,
    'connection': failed ? 'error' : 'ok',
    if (settings.desktopName case final name? when name.isNotEmpty) 'desktopName': name,
    'approvals': approvalsPart ?? const {'count': 0},
    'executing': executingPart ?? const {'count': 0},
    'today': todayPart ?? const {'count': 0, 'overdue': 0, 'titles': <String>[]},
  };
}

Map<String, String> _titles(List<Task>? tasks) => {
      for (final task in _flatten(tasks ?? const [])) task.id: task.title,
    };

String? _keptTitle(Map<String, Object?>? previous, String taskId) {
  final top = (previous?['executing'] as Map?)?['top'];
  if (top is Map && top['taskId'] == taskId) return top['title'] as String?;
  return null;
}

/// updatedAt を除いた中身（同じなら書き直さない判定に使う）
String _content(Map<String, Object?> snapshot) =>
    jsonEncode({...snapshot}..remove('updatedAt'));

/// スナップショットのまとめ書き。[schedule] で1秒待ってから、[flushNow] ならすぐ書く
class HomeWidgetSync {
  final HomeScreenBridge _bridge;
  final Map<String, Object?>? Function(Map<String, Object?>? previous) _build;
  final DateTime Function() _now;
  final Duration debounce;

  Timer? _timer;
  Map<String, Object?>? _last;
  String? _lastContent;
  DateTime? _lastWrittenAt;

  HomeWidgetSync({
    required HomeScreenBridge bridge,
    required Map<String, Object?>? Function(Map<String, Object?>? previous) build,
    DateTime Function()? now,
    this.debounce = const Duration(seconds: 1),
  })  : _bridge = bridge,
        _build = build,
        _now = now ?? DateTime.now;

  /// 最後に書いたスナップショット
  Map<String, Object?>? get last => _last;

  /// 変化があったことを知らせる。[debounce] の間に続いた変化はまとめて1回にする
  void schedule() {
    _timer?.cancel();
    _timer = Timer(debounce, () => flushNow());
  }

  /// 待たずに今の値で書く（中身が同じで、書いてから間もなければ書かない）
  Future<void> flushNow() async {
    _timer?.cancel();
    _timer = null;
    final snapshot = _build(_last);
    if (snapshot == null) return;
    final content = _content(snapshot);
    final now = _now();
    final fresh = _lastWrittenAt != null && now.difference(_lastWrittenAt!) < widgetRefreshInterval;
    if (content == _lastContent && fresh) return;
    _last = snapshot;
    _lastContent = content;
    _lastWrittenAt = now;
    await _bridge.writeWidgetSnapshot(snapshot);
  }

  void dispose() => _timer?.cancel();
}

/// アプリ起動中ずっと3つの一覧と接続設定を見張り、ウィジェットのスナップショットを書く。
/// app.dart で watch して常駐させる。iOS 以外では何もしない（null）
final homeWidgetSyncProvider = Provider<HomeWidgetSync?>((ref) {
  final bridge = ref.watch(homeScreenBridgeProvider);
  if (!bridge.isSupported) return null;

  const allTasks = TaskFilter();
  final sync = HomeWidgetSync(
    bridge: bridge,
    build: (previous) => buildWidgetSnapshot(
      now: DateTime.now(),
      settings: ref.read(connectionSettingsProvider),
      approvals: ref.read(approvalListProvider),
      executing: ref.read(executingTasksProvider),
      tasks: ref.read(taskListProvider(allTasks)),
      previous: previous,
    ),
  );

  void changed(Object? _, Object? __) => sync.schedule();
  ref.listen(connectionSettingsProvider, changed, fireImmediately: true);
  ref.listen(approvalListProvider, changed);
  ref.listen(executingTasksProvider, changed);
  ref.listen(taskListProvider(allTasks), changed);

  ref.onDispose(sync.dispose);
  return sync;
});
