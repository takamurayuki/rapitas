import 'package:flutter/material.dart';
import '../../widgets/voice_mode_indicator.dart';

// 実行画面の AppBar（通常時と検索モード）。形はタスク画面（task_list_screen.dart）の
// _buildAppBar / _buildSearchAppBar にそろえる。状態は画面側（agent_execution_screen.dart）が持つ。

/// 通常時の AppBar：タイトル＋音声インジケーター＋検索＋フィルター（条件適用中は Badge）
///
/// @param filterActive - show the badge on the filter icon / フィルターアイコンに Badge を出すか
/// @param onSearch - opens the search mode / 検索モードを開く
/// @param onFilter - opens the filter sheet / フィルターシートを開く
/// @returns the app bar / AppBar
PreferredSizeWidget buildExecAppBar({
  required bool filterActive,
  required VoidCallback onSearch,
  required VoidCallback onFilter,
}) {
  return AppBar(
    // NOTE: 音声での実行・停止・再開は音声操作モードから（聞き取り表示はアイコンの左隣。「2番目を停止」など）
    title: const Text('エージェント実行'),
    actions: [
      const VoiceModeIndicator(trailing: false),
      IconButton(
        key: const ValueKey('exec-search-open'),
        icon: const Icon(Icons.search),
        tooltip: '検索',
        onPressed: onSearch,
      ),
      IconButton(
        key: const ValueKey('exec-filter-open'),
        icon: Badge(isLabelVisible: filterActive, child: const Icon(Icons.filter_list)),
        tooltip: 'フィルター',
        onPressed: onFilter,
      ),
    ],
  );
}

/// 検索モードの AppBar：閉じる矢印＋入力欄＋（入力があれば）クリア＋音声インジケーター。
/// 入力は即時に絞り込みへ反映する（クライアント側の絞り込み。サーバー検索はしない）
///
/// @param controller - the search field controller / 検索欄のコントローラー
/// @param onClose - closes the search mode / 検索モードを閉じる
/// @param onChanged - called on every edit / 入力のたびに呼ぶ
/// @returns the app bar / AppBar
PreferredSizeWidget buildExecSearchAppBar({
  required TextEditingController controller,
  required VoidCallback onClose,
  required ValueChanged<String> onChanged,
}) {
  return AppBar(
    leading: IconButton(
      key: const ValueKey('exec-search-close'),
      icon: const Icon(Icons.arrow_back),
      tooltip: '検索を閉じる',
      onPressed: onClose,
    ),
    title: TextField(
      key: const ValueKey('exec-filter-search'),
      controller: controller,
      autofocus: true,
      textInputAction: TextInputAction.search,
      decoration: const InputDecoration(
        hintText: 'タスク名・テーマ名で検索',
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
          key: const ValueKey('exec-search-clear'),
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
