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
/// 回答の後に始めた再取得でその待ちが消えたとき、または [answeredHideWindow] を過ぎてから始めた
/// 再取得が成功したときに [pruneAnswered] で外す。
final answeredQuestionsProvider = StateProvider<Map<String, DateTime>>((ref) => const {});

/// [executingTasksProvider] の現在の状態と、その値がいつ始めた取得の成功結果か。
class ExecutingTasksSnapshot {
  /// 実行中一覧の状態（再取得中・失敗時は直前の値を保持していることがある）。
  final AsyncValue<List<ExecutingTask>> value;

  /// 今の値を返した取得を始めた時刻。今の状態が完了した成功（再取得中でも失敗でもない）のときだけ入る。
  final DateTime? fetchStartedAt;

  const ExecutingTasksSnapshot(this.value, this.fetchStartedAt);

  /// 新鮮な成功結果の一覧。再取得中・失敗・取得時刻不明なら null。
  List<ExecutingTask>? get freshRows => fetchStartedAt == null ? null : value.valueOrNull;
}

/// [executingTasksProvider] を見張り、成功した値に「その取得を始めた時刻」を添える。
///
/// NOTE: Riverpod は再取得中（AsyncLoading）や失敗（AsyncError）でも直前の値を valueOrNull で
/// 返し続ける。回答済みの期限切れを「新しい待ち」と判定するには、期限より後に始めた取得の
/// 成功結果が要るので、取得の開始（loading になった時点）の時刻をここで覚える。
class ExecutingTasksSnapshotNotifier extends Notifier<ExecutingTasksSnapshot> {
  DateTime? _requestedAt;

  @override
  ExecutingTasksSnapshot build() {
    ref.listen<AsyncValue<List<ExecutingTask>>>(executingTasksProvider, (_, next) => state = _snapshotOf(next));
    return _snapshotOf(ref.read(executingTasksProvider));
  }

  ExecutingTasksSnapshot _snapshotOf(AsyncValue<List<ExecutingTask>> value) {
    if (value.isLoading) {
      _requestedAt = ref.read(answeredClockProvider)();
      return ExecutingTasksSnapshot(value, null);
    }
    // 見張る前に取得が済んでいた値は開始時刻が分からないので、新鮮とみなさない
    return ExecutingTasksSnapshot(value, value is AsyncData ? _requestedAt : null);
  }
}

/// 取得の開始時刻つきの実行中一覧。承認ページの質問一覧と回答済みの記録の整理が使う。
final executingTasksSnapshotProvider =
    NotifierProvider<ExecutingTasksSnapshotNotifier, ExecutingTasksSnapshot>(ExecutingTasksSnapshotNotifier.new);

/// 入力待ちの実行を来た順（古いものから）に並べたもの。回答済みは除く。
///
/// NOTE: 並びの基準は実行の startedAt（無ければ sessionStartedAt）で、質問の発生順ではない。
/// 質問が出た時刻はバックエンドのどこにも記録されておらず（AgentExecution に updatedAt も
/// 無い）、現行データでは質問の発生順を判定できないため、実行開始時刻を近似として使う
/// （カードの表示も「実行開始 N分前」とし、質問の時刻のように見せない）。仕様合意済み。
///
/// NOTE: 期限を過ぎた記録も、期限より後に始めた取得が成功するまでは隠し続ける。期限の時点で
/// 手元にあるのは期限前の古い一覧（再取得中・失敗時も同じ値が残る）で、そこにある入力待ちは
/// 回答済みの待ちそのものかもしれない。それを出すと、空の回答欄で同じ待ちへ再送できてしまう。
final pendingQuestionsProvider = Provider<AsyncValue<List<ExecutingTask>>>((ref) {
  final answered = ref.watch(answeredQuestionsProvider);
  final now = ref.watch(answeredClockProvider)();
  final snapshot = ref.watch(executingTasksSnapshotProvider);
  final fetchedSince = snapshot.fetchStartedAt;
  final hidden = <String>{};
  DateTime? nextExpiry;
  var staleAfterExpiry = false;
  for (final entry in answered.entries) {
    final expiry = entry.value.add(answeredHideWindow);
    if (expiry.isAfter(now)) {
      hidden.add(entry.key);
      if (nextExpiry == null || expiry.isBefore(nextExpiry)) nextExpiry = expiry;
    } else if (fetchedSince == null || fetchedSince.isBefore(expiry)) {
      hidden.add(entry.key);
      // 期限前の取得の成功のまま止まっている（期限のタイマーを逃した等）なら読み直す。
      // 再取得中は応答を待ち、失敗時は再試行に任せる（自動で繰り返さない）
      // NOTE: 再取得中も直前の成功値を持つ AsyncData（isLoading）になるので、isLoading も見る
      if (snapshot.value is AsyncData && !snapshot.value.isLoading) staleAfterExpiry = true;
    }
  }
  if (nextExpiry != null) {
    // 期限が来たら読み直す。その応答がまだ入力待ちなら、それは新しい待ちとして出す
    final timer = Timer(nextExpiry.difference(now), () => ref.invalidate(executingTasksProvider));
    ref.onDispose(timer.cancel);
  }
  if (staleAfterExpiry) {
    // build の中では invalidate できないので、次のイベントに回す
    final timer = Timer(Duration.zero, () => ref.invalidate(executingTasksProvider));
    ref.onDispose(timer.cancel);
  }
  return snapshot.value.whenData((rows) {
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

/// 回答済みの記録のうち、新鮮な取得の結果から外してよいものを外す。
///
/// 回答より後に始めた取得で入力待ちとして無くなった記録と、期限より後に始めた取得が成功した記録を外す。
/// 再取得中・失敗時の古い一覧では呼ばない（呼び出し側は [ExecutingTasksSnapshot.freshRows] を使う）。
///
/// @param answered - 回答済みの記録（識別子 → 送り終えた時刻） / 回答済みの記録
/// @param rows - 成功した GET /tasks/executing の一覧 / 成功した実行中一覧
/// @param fetchStartedAt - その一覧を返した取得を始めた時刻 / 取得の開始時刻
/// @returns 残す記録だけ（変化が無ければ同じ Map） / 残す記録（変化なしなら同一インスタンス）
Map<String, DateTime> pruneAnswered(Map<String, DateTime> answered, List<ExecutingTask> rows, DateTime fetchStartedAt) {
  if (answered.isEmpty) return answered;
  final stillWaiting = rows.where((r) => r.isWaitingForInput).map(answeredKeyOf).toSet();
  bool keep(String key, DateTime answeredAt) {
    // 回答より前に始めた取得は、回答後のバックエンドの状態を表さない
    if (fetchStartedAt.isBefore(answeredAt)) return true;
    if (!stillWaiting.contains(key)) return false;
    return answeredAt.add(answeredHideWindow).isAfter(fetchStartedAt);
  }

  final kept = {
    for (final e in answered.entries)
      if (keep(e.key, e.value)) e.key: e.value,
  };
  return kept.length == answered.length ? answered : kept;
}
