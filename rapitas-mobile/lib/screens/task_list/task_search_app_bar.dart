import 'package:flutter/material.dart';
import '../../models/task.dart';
import '../../widgets/voice_mode_indicator.dart';

// タスク画面の検索モード（AppBar の差し替えと、表示中の一覧のその場の絞り込み）。
// 形は実行画面の検索モード（agent_execution/exec_app_bars.dart の buildExecSearchAppBar）と同一にする。
// 状態（検索モードか・語句・声で開いたか）は画面側（task_list_screen.dart）が持つ。
// NOTE: nav72 で nav71 の常時表示の検索欄とサーバ検索（searchTasks）をやめ、この形に戻した。

/// 検索モードの AppBar：閉じる矢印＋入力欄＋（入力があれば）クリア＋音声インジケーター。
/// 入力は即時に一覧の絞り込みへ反映する（クライアント側。サーバー検索はしない）
///
/// @param controller - the search field controller / 検索欄のコントローラー
/// @param autofocus - focus the field on open (false when opened by voice) / 開いたときにフォーカスするか（声で開いたときは false）
/// @param onClose - closes the search mode / 検索モードを閉じる
/// @param onChanged - called on every edit / 入力のたびに呼ぶ
/// @returns the app bar / AppBar
PreferredSizeWidget buildTaskSearchAppBar({
  required TextEditingController controller,
  required bool autofocus,
  required VoidCallback onClose,
  required ValueChanged<String> onChanged,
}) {
  return AppBar(
    leading: IconButton(
      key: const ValueKey('task-search-close'),
      icon: const Icon(Icons.arrow_back),
      tooltip: '検索を閉じる',
      onPressed: onClose,
    ),
    title: TextField(
      key: const ValueKey('task-search-field'),
      controller: controller,
      // 声の「検索 ◯◯」で開いたときはフォーカスしない（キーボードが出ると常時聞き取りが止まる）
      autofocus: autofocus,
      textInputAction: TextInputAction.search,
      decoration: const InputDecoration(
        hintText: 'タスクを検索',
        border: InputBorder.none,
        filled: false,
      ),
      onChanged: onChanged,
    ),
    actions: [
      // 右にクリアが無いときは右端になるので、右端用の余白を取る
      VoiceModeIndicator(trailing: controller.text.isEmpty),
      if (controller.text.isNotEmpty)
        IconButton(
          key: const ValueKey('task-search-clear'),
          icon: const Icon(Icons.clear),
          tooltip: 'クリア',
          onPressed: () {
            controller.clear();
            onChanged('');
          },
        ),
    ],
  );
}

/// 表示中の一覧を、タイトルまたは説明の部分一致（大文字小文字を区別しない）で絞る。空の語句ならそのまま返す
///
/// @param tasks - the visible list (theme / status / priority already applied) / 表示中の一覧（テーマ・状態・優先度の絞り込み適用後）
/// @param query - the search words / 検索語
/// @returns matching tasks in the original order / 一致したタスク（元の並び順）
List<Task> applyTaskSearch(List<Task> tasks, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return tasks;
  return [
    for (final t in tasks)
      if (t.title.toLowerCase().contains(q) || (t.description?.toLowerCase().contains(q) ?? false)) t,
  ];
}
