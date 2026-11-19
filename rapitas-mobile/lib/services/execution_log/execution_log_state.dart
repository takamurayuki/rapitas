/// 実行ログの「いまの状態」1行（実行中／入力待ち／エラー／完了 など＋短い説明）を作る。
///
/// 状態は実行の status を正とし、説明だけを出来事から拾う。
library;

import 'execution_log_types.dart';
import 'execution_log_snapshot.dart';

/// 実行の状態と出来事から、画面上部の1行を作る。
///
/// @param s - 取得した実行ログ（status・question・errorMessage を使う） / 実行ログ
/// @param events - 絞り込んだ出来事 / 出来事の並び
/// @returns 状態の1行 / いまの状態
ExecLogState execLogStateOf(ExecutionLogSnapshot s, List<ExecLogEvent> events) {
  String? lastOf(ExecLogKind kind) {
    final e = events.lastWhere((e) => e.kind == kind, orElse: () => ExecLogEvent(kind, ''));
    final text = e.body ?? (e.title.isEmpty ? null : e.title);
    return text == null || text.isEmpty ? null : firstLineOf(text);
  }

  switch (s.status) {
    case 'waiting_for_input':
      return ExecLogState(ExecLogPhase.waiting, '入力待ち', s.question ?? lastOf(ExecLogKind.question) ?? '回答を待っています');
    case 'failed':
      return ExecLogState(ExecLogPhase.error, 'エラー', s.errorMessage ?? lastOf(ExecLogKind.error));
    case 'completed':
      return ExecLogState(ExecLogPhase.done, '完了', lastOf(ExecLogKind.done) ?? '実行が完了しました');
    case 'cancelled':
      return const ExecLogState(ExecLogPhase.stopped, '停止', '実行を停止しました');
    case 'interrupted':
      return ExecLogState(ExecLogPhase.interrupted, '中断', s.errorMessage ?? '中断されています（再開できます）');
    case 'running':
    case 'pending':
      return ExecLogState(ExecLogPhase.running, '実行中', _nowDoing(events));
    default:
      return events.isEmpty
          ? const ExecLogState(ExecLogPhase.idle, '記録なし', 'ログはまだありません')
          : ExecLogState(ExecLogPhase.idle, '状態不明', _nowDoing(events));
  }
}

/// 実行中の「いま何をしているか」：最後の出来事から短く作る
String _nowDoing(List<ExecLogEvent> events) {
  final last = events.lastOrNull;
  if (last == null) return '準備しています';
  return switch (last.kind) {
    ExecLogKind.work => last.items.isEmpty ? '作業しています' : last.items.last,
    ExecLogKind.speech => firstLineOf(last.body ?? last.title),
    ExecLogKind.start => '開始しました',
    _ => firstLineOf(last.body ?? last.title),
  };
}
