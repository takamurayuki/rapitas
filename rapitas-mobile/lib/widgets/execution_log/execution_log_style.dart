/// 実行ログ表示の、出来事の種類・状態ごとのアイコンと色、時刻の書式。
///
/// 種類の見分けそのもの（どの行がどの種類か）は services/execution_log が持つ。
library;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../services/execution_log/execution_log_digest.dart';

/// 出来事のアイコンと色
({IconData icon, Color color}) execLogKindStyle(BuildContext context, ExecLogKind kind) {
  final scheme = Theme.of(context).colorScheme;
  return switch (kind) {
    ExecLogKind.start => (icon: Icons.play_arrow_rounded, color: scheme.primary),
    ExecLogKind.speech => (icon: Icons.chat_bubble_outline, color: scheme.onSurfaceVariant),
    ExecLogKind.work => (icon: Icons.build_outlined, color: scheme.outline),
    // NOTE: 入力待ちは実行画面のタイルも help_outline＋橙。同じ意味なので同じ見た目にそろえる
    ExecLogKind.question => (icon: Icons.help_outline, color: Colors.orange.shade800),
    ExecLogKind.warning => (icon: Icons.warning_amber, color: Colors.amber.shade800),
    ExecLogKind.error => (icon: Icons.error_outline, color: scheme.error),
    ExecLogKind.done => (icon: Icons.check_circle_outline, color: Colors.green.shade700),
    ExecLogKind.milestone => (icon: Icons.flag_outlined, color: scheme.outline),
  };
}

/// 「いまの状態」のアイコンと色
({IconData icon, Color color}) execLogPhaseStyle(BuildContext context, ExecLogPhase phase) {
  final scheme = Theme.of(context).colorScheme;
  return switch (phase) {
    ExecLogPhase.running => (icon: Icons.sync, color: scheme.primary),
    ExecLogPhase.waiting => (icon: Icons.help_outline, color: Colors.orange.shade800),
    ExecLogPhase.error => (icon: Icons.error_outline, color: scheme.error),
    ExecLogPhase.done => (icon: Icons.check_circle_outline, color: Colors.green.shade700),
    ExecLogPhase.stopped => (icon: Icons.stop_circle_outlined, color: scheme.outline),
    // 再開可能な実行のタイル（pause_circle＋琥珀）と同じ意味
    ExecLogPhase.interrupted => (icon: Icons.pause_circle_outline, color: Colors.amber.shade800),
    ExecLogPhase.idle => (icon: Icons.hourglass_empty, color: scheme.outline),
  };
}

final _clock = DateFormat('HH:mm:ss');

/// ログの時刻（端末の時刻帯で HH:mm:ss）。無ければ空文字
String execLogClock(DateTime? time) => time == null ? '' : _clock.format(time.toLocal());
