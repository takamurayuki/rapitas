/// 実行ログをボトムシートで開く。実行画面（実行中・再開可能のタイル）とタスク詳細の両方から呼ぶ。
library;

import 'package:flutter/material.dart';

import 'execution_log_panel.dart';

/// 実行ログのシートを開く。
///
/// @param context - 呼び出し元 / 呼び出し元の BuildContext
/// @param title - タスク名（見出しに出す） / タスク名
/// @param taskId - タスクID / タスクID
/// @param executionId - 実行ID。null ならタスクの最新セッション全体 / 実行ID
/// @returns シートが閉じたら完了する Future / 閉じるまで待つ Future
Future<void> showExecutionLogSheet(
  BuildContext context, {
  required String title,
  required String taskId,
  String? executionId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (context) => DraggableScrollableSheet(
      initialChildSize: 0.8,
      minChildSize: 0.3,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) => ExecutionLogPanel(
        title: title,
        taskId: taskId,
        executionId: executionId,
        scrollController: scrollController,
        onClose: () => Navigator.pop(context),
      ),
    ),
  );
}
