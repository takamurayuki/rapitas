import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/task_card.dart';

// タスク画面のインライン検索（一覧上部の常時表示の検索欄と、一覧の場所に出す検索結果）。
// 検索語・デバウンス・結果の世代管理は画面側（task_list_screen.dart）が持つ。ここは表示だけ。
// NOTE: nav71 で検索アイコン → 検索モード（AppBar の差し替え）を廃止し、この形に変えた。

/// 一覧上部の検索欄。見た目は nav68 時代の実行画面の検索欄（枠線・左に検索アイコン・入力があれば右にクリア）。
///
/// 自動フォーカスはしない（声の「検索 ◯◯」で語句が入っても、フォーカスやキーボードで常時聞き取りを止めない）。
class TaskSearchField extends StatelessWidget {
  final TextEditingController controller;

  /// 入力のたび（デバウンスは画面側）
  final ValueChanged<String> onChanged;

  /// キーボードの検索ボタン
  final ValueChanged<String> onSubmitted;

  /// クリア（×）
  final VoidCallback onClear;

  const TaskSearchField({
    super.key,
    required this.controller,
    required this.onChanged,
    required this.onSubmitted,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: TextField(
        key: const ValueKey('task-search-field'),
        controller: controller,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          isDense: true,
          hintText: 'タスクを検索',
          prefixIcon: const Icon(Icons.search),
          suffixIcon: controller.text.isNotEmpty
              ? IconButton(
                  key: const ValueKey('task-search-clear'),
                  tooltip: 'クリア',
                  icon: const Icon(Icons.clear),
                  onPressed: onClear,
                )
              : null,
          border: const OutlineInputBorder(),
        ),
        onChanged: onChanged,
        onSubmitted: onSubmitted,
      ),
    );
  }
}

/// 検索結果（サーバ検索 searchTasks、全テーマ対象）。読み込み中・0件・失敗＋再試行の表示は検索モード時代のまま。
///
/// 引っ張って更新では現在の語句で検索し直す（[onRefresh]）。
class TaskSearchResults extends StatelessWidget {
  /// 検索結果。null はまだ結果が無い（デバウンス待ち）
  final AsyncValue<List<Task>>? results;

  /// 結果のタスクを開く
  final ValueChanged<Task> onOpen;

  /// 現在の語句で検索し直す（再試行・引っ張って更新）
  final Future<void> Function() onRefresh;

  const TaskSearchResults({
    super.key,
    required this.results,
    required this.onOpen,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(onRefresh: onRefresh, child: _buildBody());
  }

  Widget _buildBody() {
    final results = this.results;
    // 入力直後のデバウンス待ち。一覧に戻すと入力のたびにちらつくので、読み込み中と同じ表示にする
    if (results == null) return const Center(child: CircularProgressIndicator());
    return results.when(
      data: (tasks) {
        if (tasks.isEmpty) {
          return const CenteredMessage(icon: Icons.search_off, message: '見つかりませんでした');
        }
        return ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(8),
          itemCount: tasks.length,
          itemBuilder: (context, index) {
            final task = tasks[index];
            return TaskCard(task: task, onTap: () => onOpen(task));
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => CenteredMessage(
        icon: Icons.error_outline,
        iconColor: Colors.red,
        message: '検索に失敗しました',
        action: ElevatedButton(onPressed: onRefresh, child: const Text('再試行')),
      ),
    );
  }
}
