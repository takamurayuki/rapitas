import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/theme_data_provider.dart';
import 'exec_filter.dart';
import 'exec_filter_sheet.dart';

// 実行画面の適用中チップ列（タスク画面の「適用中のフィルター」の InputChip 列と同じ形）と、条件のクリア。
// NOTE: 以前ここにあった常時表示の絞り込みバー（検索欄＋ポップアップメニュー）は廃止した。
// 検索は AppBar の検索モード、テーマ・状態・並び順はフィルターシート（exec_filter_sheet.dart）から。

/// 絞り込み条件をまとめて既定（絞り込みなし・新しい順）に戻す
void clearExecFilter(WidgetRef ref) {
  ref.read(execFilterProvider.notifier).state = const ExecFilter();
}

/// シートで扱う条件（テーマ・状態・並び順）が既定から変わっているか。
/// フィルターアイコンの Badge とチップ列の表示に使う。検索はモードなので含めない（タスク画面と同じ流儀）
///
/// @param filter - current conditions / 現在の条件
/// @returns true when the sheet has non-default choices / シートの条件が既定以外なら true
bool execSheetFilterActive(ExecFilter filter) =>
    filter.hasThemes || filter.status != ExecStatusFilter.all || filter.sort != ExecSort.newest;

/// 本文上部の適用中チップ列。テーマは選択中の1件ごとにチップを出し、タップでシートを開き直す・×でそのテーマだけ外す。
/// 状態・並び順は×で個別に解除する
class ExecActiveFilterChips extends ConsumerWidget {
  const ExecActiveFilterChips({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(execFilterProvider);
    if (!execSheetFilterActive(filter)) return const SizedBox.shrink();
    void update(ExecFilter Function(ExecFilter) change) {
      final notifier = ref.read(execFilterProvider.notifier);
      notifier.state = change(notifier.state);
    }

    // Align は親の幅いっぱいに広がる（中の Wrap だけが中身の幅）。タスク画面のチップ列と同じ形
    return Padding(
      key: const ValueKey('exec-active-filter-chips'),
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 4),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final themeId in filter.themeIds)
              InputChip(
                key: ValueKey('exec-active-theme-$themeId'),
                label: Text('テーマ：${_themeName(ref, themeId)}'),
                onPressed: () => showExecFilterSheet(context, ref),
                tooltip: 'テーマを変更',
                onDeleted: () => update((f) => f.toggleTheme(themeId)),
                deleteButtonTooltipMessage: 'このテーマの絞り込みを解除',
              ),
            if (filter.status != ExecStatusFilter.all)
              InputChip(
                key: const ValueKey('exec-active-status'),
                label: Text('状態：${execStatusLabels[filter.status]}'),
                onDeleted: () => update((f) => f.copyWith(status: ExecStatusFilter.all)),
                deleteButtonTooltipMessage: '状態の絞り込みを解除',
              ),
            if (filter.sort == ExecSort.oldest)
              InputChip(
                key: const ValueKey('exec-active-sort'),
                label: Text(execSortLabels[ExecSort.oldest]!),
                onDeleted: () => update((f) => f.copyWith(sort: ExecSort.newest)),
                deleteButtonTooltipMessage: '新しい順に戻す',
              ),
          ],
        ),
      ),
    );
  }

  /// 名前は開発テーマに限らず全テーマから引く（候補の制限前に選ばれた非開発テーマでも名前を出す）。
  /// 一覧に無い（削除・取得前）ときも条件は残るので、その旨を名前の代わりに出す
  static String _themeName(WidgetRef ref, String themeId) {
    final themes = ref.watch(themeListProvider).valueOrNull;
    return themes?.where((t) => t.id == themeId).firstOrNull?.name ?? '選択中のテーマ';
  }
}
