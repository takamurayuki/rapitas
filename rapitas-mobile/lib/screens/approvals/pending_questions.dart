import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';

// 承認ページの「エージェントの質問」に出す入力待ちの実行。
//
// 元は GET /tasks/executing（executingTasksProvider）の waiting_for_input の行。
// 回答の送信に成功した待ちは、バックエンドが running に変えるまでの間も
// 一覧から外す（継続は fire-and-forget なので、直後の再取得ではまだ入力待ちが返りうる）。

/// 回答済みとして隠す待ちの識別子。同じ実行が改めて別の質問を出したら別物として出す。
String answeredKeyOf(ExecutingTask task) => '${task.executionId}|${task.question ?? ''}';

/// 回答を送り終えた待ち（[answeredKeyOf]）。再取得でその待ちが消えたら [pruneAnswered] で外す。
final answeredQuestionsProvider = StateProvider<Set<String>>((ref) => const {});

/// 入力待ちの実行を来た順（古いものから）に並べたもの。回答済みは除く。
/// 並びの基準は実行の startedAt（無ければ sessionStartedAt）。質問が出た時刻そのものは
/// バックエンドに記録が無いため、これを近似として使う。
final pendingQuestionsProvider = Provider<AsyncValue<List<ExecutingTask>>>((ref) {
  final answered = ref.watch(answeredQuestionsProvider);
  return ref.watch(executingTasksProvider).whenData((rows) {
    final waiting = rows.where((r) => r.isWaitingForInput && !answered.contains(answeredKeyOf(r))).toList();
    waiting.sort(_byArrival);
    return waiting;
  });
});

int _byArrival(ExecutingTask a, ExecutingTask b) {
  final at = a.startedAt ?? a.sessionStartedAt;
  final bt = b.startedAt ?? b.sessionStartedAt;
  if (at != null && bt != null && at != bt) return at.compareTo(bt);
  if (at == null && bt != null) return 1; // 時刻の無い行は後ろ
  if (at != null && bt == null) return -1;
  return (int.tryParse(a.executionId) ?? 0).compareTo(int.tryParse(b.executionId) ?? 0);
}

/// 回答済みの識別子のうち、最新の一覧にもう入力待ちとして無いものを外す。
///
/// @param answered - 回答済みの識別子
/// @param rows - 最新の GET /tasks/executing
/// @returns まだ入力待ちとして残っている回答済みだけ（変化が無ければ同じ Set）
Set<String> pruneAnswered(Set<String> answered, List<ExecutingTask> rows) {
  if (answered.isEmpty) return answered;
  final stillWaiting = rows.where((r) => r.isWaitingForInput).map(answeredKeyOf).toSet();
  final kept = answered.where(stillWaiting.contains).toSet();
  return kept.length == answered.length ? answered : kept;
}
