import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import 'exec_filter.dart';
import 'execution_section_states.dart';

// 自動実行セクションのカード列（絞り込みの適用と空表示）。
// NOTE: auto_run_section.dart はバイト数のベースライン対象なので、絞り込みと案内文はこちらに置く。
// 絞り込みは表示だけ。隠したカードもツリーに残し（_kept）、カードが監視する themeAutoRunProvider
// （autoDispose）の取得とカード内の状態（操作エラー・操作待機中）を保つ。

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
    return [for (final theme in themes) _kept(theme, true, card)];
  }
  final visible = applyAutoRunThemeFilter(themes, filter);
  final shownIds = {for (final theme in visible) theme.id};
  return [
    FilterCountLine(total: themes.length, shown: visible.length),
    if (visible.isEmpty) const ExecNoMatch(key: ValueKey('auto-run-no-match'), text: '条件に合うテーマはありません'),
    // NOTE: 並びは現行維持（applyAutoRunThemeFilter は順序を変えない）なので themes の順に置いて表示だけ切り替える
    for (final theme in themes) _kept(theme, shownIds.contains(theme.id), card),
  ];
}

// NOTE: テーマIDのキーで包む。キーが無いと絞り込みの切替で別テーマのカードが同じ State を使い回し、
// 操作エラーや操作待機中が別テーマへ移る。隠すときも maintainState で State と provider の監視を残す
// （TickerMode も止まるので隠れたカードの進捗表示は動かない）。
Widget _kept(TaskTheme theme, bool visible, Widget Function(TaskTheme) card) => Visibility(
      key: ValueKey('auto-run-slot-${theme.id}'),
      visible: visible,
      maintainState: true,
      child: card(theme),
    );

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
