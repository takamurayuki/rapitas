import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';

// 承認ページの「エージェントの質問」に出す入力待ちの実行。
//
// 元は GET /tasks/executing（executingTasksProvider）の waiting_for_input の行。
// 回答の送信に成功した待ちは、バックエンドが running に変えるまでの間も
// 一覧から外す（継続は fire-and-forget なので、直後の再取得ではまだ入力待ちが返りうる）。
//
// NOTE: 回答済みの記録は [answeredHideWindow] だけ有効にする。同じ実行が同じ文面
// （または質問文なし）で再び入力待ちになり、その間の running を一度も取得できなかった場合、
// 行の中身からは「前の待ち」と「新しい待ち」を見分けられない（質問の発生時刻が返らない）。
// 期限を付けないと、新しい待ちを無期限に隠してしまう。

/// 回答済みとして隠す待ちの識別子。同じ実行が改めて別の質問を出したら別物として出す。
String answeredKeyOf(ExecutingTask task) => '${task.executionId}|${task.question ?? ''}';

/// 回答後に、同じ識別子の入力待ちを隠しておく時間。
/// 継続が DB を running に変えるまで（通常は数秒以内）を十分に覆い、かつ
/// 新しい待ちを長く隠さない長さにしている。
const answeredHideWindow = Duration(seconds: 30);

/// 回答済みの判定に使う時計。テストで差し替える。
final answeredClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// 回答を送り終えた待ち（[answeredKeyOf] → 送り終えた時刻）。
/// 再取得でその待ちが消えたとき、または [answeredHideWindow] を過ぎたときに [pruneAnswered] で外す。
final answeredQuestionsProvider = StateProvider<Map<String, DateTime>>((ref) => const {});

/// 入力待ちの実行を来た順（古いものから）に並べたもの。回答済みは除く。
///
/// NOTE: 並びの基準は実行の startedAt（無ければ sessionStartedAt）で、質問の発生順ではない。
/// 質問が出た時刻はバックエンドのどこにも記録されておらず（AgentExecution に updatedAt も
/// 無い）、現行データでは質問の発生順を判定できないため、実行開始時刻を近似として使う
/// （カードの表示も「実行開始 N分前」とし、質問の時刻のように見せない）。仕様合意済み。
final pendingQuestionsProvider = Provider<AsyncValue<List<ExecutingTask>>>((ref) {
  final answered = ref.watch(answeredQuestionsProvider);
  final now = ref.watch(answeredClockProvider)();
  final hidden = <String>{};
  DateTime? nextExpiry;
  for (final entry in answered.entries) {
    final expiry = entry.value.add(answeredHideWindow);
    if (!expiry.isAfter(now)) continue;
    hidden.add(entry.key);
    if (nextExpiry == null || expiry.isBefore(nextExpiry)) nextExpiry = expiry;
  }
  if (nextExpiry != null) {
    // 期限が来たら読み直す。まだ入力待ちならそれは新しい待ちとして出す
    final timer = Timer(nextExpiry.difference(now), () => ref.invalidate(executingTasksProvider));
    ref.onDispose(timer.cancel);
  }
  return ref.watch(executingTasksProvider).whenData((rows) {
    final waiting = rows.where((r) => r.isWaitingForInput && !hidden.contains(answeredKeyOf(r))).toList();
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

/// 回答済みの記録のうち、最新の一覧にもう入力待ちとして無いもの・期限を過ぎたものを外す。
///
/// @param answered - 回答済みの記録（識別子 → 送り終えた時刻） / 回答済みの記録
/// @param rows - 最新の GET /tasks/executing / 最新の実行中一覧
/// @param now - 現在時刻 / 現在時刻
/// @returns 残す記録だけ（変化が無ければ同じ Map） / 残す記録（変化なしなら同一インスタンス）
Map<String, DateTime> pruneAnswered(Map<String, DateTime> answered, List<ExecutingTask> rows, DateTime now) {
  if (answered.isEmpty) return answered;
  final stillWaiting = rows.where((r) => r.isWaitingForInput).map(answeredKeyOf).toSet();
  final kept = {
    for (final e in answered.entries)
      if (stillWaiting.contains(e.key) && e.value.add(answeredHideWindow).isAfter(now)) e.key: e.value,
  };
  return kept.length == answered.length ? answered : kept;
}
