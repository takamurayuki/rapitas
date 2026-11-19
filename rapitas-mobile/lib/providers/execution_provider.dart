import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/task.dart';
import '../models/task_execution.dart';
import '../services/execution_log/execution_log_snapshot.dart';
import 'service_providers.dart';
import 'task_provider.dart';

/// 実行中（running / waiting_for_input）のタスク一覧
final executingTasksProvider = FutureProvider<List<ExecutingTask>>((ref) async {
  final service = ref.watch(agentServiceProvider);
  return service.getExecutingTasks();
});

/// 再開候補の一覧（canResume でない行も含む。表示側で canResume を見て絞る）
final resumableExecutionsProvider =
    FutureProvider<List<ResumableExecution>>((ref) async {
  final service = ref.watch(agentServiceProvider);
  return service.getResumableExecutions();
});

/// タスクの実行ログ（chunk・type と、実行の状態・質問・エラー）。
/// キーは (taskId, executionId)。executionId が null ならタスクの最新セッションのログ。
final taskExecutionLogsProvider = FutureProvider.family<ExecutionLogSnapshot,
    ({String taskId, String? executionId})>((ref, key) async {
  final service = ref.watch(agentServiceProvider);
  return service.getExecutionLogSnapshot(key.taskId, executionId: key.executionId);
});

/// 実行ログを開いている間、実行中・入力待ちなら読み直す間隔。null なら回さない（テストで上書きする）。
// NOTE: SSE の execution_status は状態が変わったときにしか来ず、出力の増分では読み直されないため
final executionLogPollIntervalProvider =
    Provider<Duration?>((ref) => const Duration(seconds: 5));

/// taskId → タスク名。/tasks/executing はタスク名を返さないので、既存のタスク一覧
/// （フィルタなし）から引く。サブタスクだけが実行中のこともあるので入れ子も展開する。
/// 一覧が未取得・失敗のときは空（表示側で「タスク #<id>」にフォールバック）。
final taskTitleLookupProvider = Provider<Map<String, String>>((ref) {
  final tasks = ref.watch(taskListProvider(const TaskFilter())).valueOrNull;
  final titles = <String, String>{};
  void add(List<Task>? list) {
    if (list == null) return;
    for (final task in list) {
      titles[task.id] = task.title;
      add(task.subtasks);
    }
  }

  add(tasks);
  return titles;
});

String taskTitleOrFallback(Map<String, String> titles, String? taskId) {
  if (taskId == null) return 'タスク';
  return titles[taskId] ?? 'タスク #$taskId';
}
