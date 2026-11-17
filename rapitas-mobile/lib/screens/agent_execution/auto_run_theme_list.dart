import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import 'exec_filter.dart';
import 'execution_section_states.dart';

// 自動実行セクションのカード列（絞り込みの適用と空表示）。
// NOTE: auto_run_section.dart はバイト数のベースライン対象なので、絞り込みと案内文はこちらに置く。
// 絞り込みは表示だけで、自動実行の動作・状態（themeAutoRunProvider の取得や操作）には触れない。

/// 開発テーマのカード列。絞り込み中は件数を出し、0件なら「条件に合うもの無し」を出す。
///
/// @param themes - 開発テーマ（GET /themes の並び） / 開発テーマ一覧
/// @param card - 1テーマ分のカードを作る / カードの生成
/// @returns セクション見出しの下に並べる行 / 見出し下の行
List<Widget> autoRunThemeList(WidgetRef ref, List<TaskTheme> themes, Widget Function(TaskTheme) card) {
  final filter = ref.watch(execFilterProvider);
  if (!filter.filtersOthers) {
    if (themes.isEmpty) {
      return const [
        AutoRunMessageCard(
          key: ValueKey('auto-run-empty'),
          icon: Icons.info_outline,
          text: '開発テーマがありません。テーマの編集で「開発テーマ」をオンにして作業フォルダを設定すると、'
              'ここからテーマのタスクを自動実行できます。',
        ),
      ];
    }
    return [for (final theme in themes) card(theme)];
  }
  final visible = applyAutoRunThemeFilter(themes, filter);
  return [
    FilterCountLine(total: themes.length, shown: visible.length),
    if (visible.isEmpty) const ExecNoMatch(key: ValueKey('auto-run-no-match'), text: '条件に合うテーマはありません'),
    for (final theme in visible) card(theme),
  ];
}

/// 自動実行セクションの1行の案内（取得失敗・開発テーマなし）
class AutoRunMessageCard extends StatelessWidget {
  final IconData icon;
  final String text;
  final Widget? action;

  const AutoRunMessageCard({super.key, required this.icon, required this.text, this.action});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
        child: Row(
          children: [
            Icon(icon, size: 20, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
            if (action != null) action!,
          ],
        ),
      ),
    );
  }
}
