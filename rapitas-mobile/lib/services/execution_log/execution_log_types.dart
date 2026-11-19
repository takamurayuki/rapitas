/// 実行ログの絞り込みで使う型（出来事・状態）。
///
/// 作り方は execution_log_digest.dart（出来事）と execution_log_state.dart（状態）が持つ。
library;

/// 出来事の種類
enum ExecLogKind { start, speech, work, question, warning, error, done, milestone }

/// タイムラインの1件
class ExecLogEvent {
  final ExecLogKind kind;
  String title;

  /// 全文（長ければ表示側で先頭だけ出し、タップで広げる）
  String? body;
  final DateTime? time;
  DateTime? lastTime;

  /// 同じ内容の連続の件数。作業なら操作の件数、stderr ならまとめた行数
  int count;

  /// 作業の項目（ツール呼び出し1件 = 1項目）
  final List<String> items = [];

  /// 作業のうち失敗した件数
  int failures = 0;

  /// 作業の失敗時に記録された出力（Codex の Command Failed の末尾）
  String? detail;

  ExecLogEvent(this.kind, this.title, {this.body, this.time, this.count = 1}) : lastTime = time;
}

/// 「いまの状態」の区分
enum ExecLogPhase { running, waiting, error, done, stopped, interrupted, idle }

/// 画面上部の1行
class ExecLogState {
  final ExecLogPhase phase;
  final String label;
  final String? description;

  const ExecLogState(this.phase, this.label, [this.description]);
}

/// 文の1行目（前後の空白を除く）
String firstLineOf(String text) => text.trim().split('\n').first.trim();
