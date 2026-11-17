import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/theme_data_provider.dart';
import '../task_list/task_theme_filter_section.dart' show FilterDotLabel;
import 'exec_filter.dart';

// 実行画面のフィルターシート（テーマ → 状態 → 並び順）。見た目と操作はタスク画面の
// task_filter_sheet.dart にそろえる。条件の中身と適用は exec_filter.dart のまま変えない。

/// 状態チップの表示名
const execStatusLabels = {
  ExecStatusFilter.all: 'すべて',
  ExecStatusFilter.running: '実行中',
  ExecStatusFilter.waitingForInput: '入力待ち',
};

/// 並び順チップの表示名
const execSortLabels = {ExecSort.newest: '新しい順', ExecSort.oldest: '古い順'};

/// シートのテーマ候補。開発テーマ（isDevelopment）だけをカテゴリでまとめる。
///
/// 開発テーマが1つも無いカテゴリはグループごと出ない。カテゴリに属さない開発テーマは
/// 最後の「その他」グループに残す（実行画面では作業フォルダを持つ開発テーマが絞り込み対象なので、
/// タスク画面のようにカテゴリなしを候補から外すと、そのテーマで絞る手段がなくなる）。
///
/// @param themes - all themes from themeListProvider / 全テーマ
/// @returns development-theme groups / 開発テーマだけのカテゴリ別グループ
List<ThemeCategoryGroup> execThemeCandidateGroups(List<TaskTheme> themes) {
  return groupThemesByCategory([for (final t in themes) if (t.isDevelopment) t]);
}

/// 実行画面のフィルターシートを開く。
///
/// テーマ・状態・並び順のチップは選ぶと即適用して閉じる。カテゴリはテーマ候補を切り替えるだけで、
/// 条件には触れない（実行画面には「すべて」があり、タスク画面の「常に1テーマ必須」は持ち込まない）。
///
/// @param context - context to show the sheet from / シートを出す元の context
/// @param ref - ref of the executions screen / 実行画面の ref
void showExecFilterSheet(BuildContext context, WidgetRef ref) {
  // カテゴリの選択はシート内だけの状態。builder が再実行されても消えないようここで持つ
  ({String? id})? selectedCategory;

  void apply(BuildContext sheetContext, ExecFilter Function(ExecFilter) change) {
    final notifier = ref.read(execFilterProvider.notifier);
    notifier.state = change(notifier.state);
    Navigator.pop(sheetContext);
  }

  showModalBottomSheet<void>(
    context: context,
    builder: (context) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Consumer(
          builder: (context, ref, _) {
            final filter = ref.watch(execFilterProvider);
            final titleStyle = Theme.of(context).textTheme.titleSmall;
            final themesAsync = ref.watch(themeListProvider);
            final groups = execThemeCandidateGroups(themesAsync.valueOrNull ?? const []);
            return Column(
              key: const ValueKey('exec-filter-sheet'),
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('フィルター', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                if (themesAsync.isLoading && !themesAsync.hasValue)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 16),
                    child: LinearProgressIndicator(),
                  )
                // 取得失敗・開発テーマ0件ならテーマセクションごと出さない（タスク画面と同じ方針）
                else if (groups.isNotEmpty)
                  StatefulBuilder(
                    builder: (context, setSheetState) {
                      selectedCategory ??= (id: _categoryIdOfTheme(groups, filter.themeId) ?? groups.first.categoryId);
                      final current = selectedCategory!.id;
                      return ExecThemeFilterSection(
                        groups: groups,
                        selectedGroup: groups.firstWhere((g) => g.categoryId == current, orElse: () => groups.first),
                        selectedThemeId: filter.themeId,
                        onCategorySelected: (group) => setSheetState(() => selectedCategory = (id: group.categoryId)),
                        onThemeSelected: (id) => apply(
                          context,
                          (f) => id == null ? f.copyWith(clearThemeId: true) : f.copyWith(themeId: id),
                        ),
                      );
                    },
                  ),
                Text('状態', style: titleStyle),
                Text(
                  '実行中のリストだけに効きます',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final e in execStatusLabels.entries)
                      FilterChip(
                        key: ValueKey('exec-sheet-status-${e.key.name}'),
                        label: Text(e.value),
                        selected: filter.status == e.key,
                        onSelected: (_) => apply(context, (f) => f.copyWith(status: e.key)),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text('並び順', style: titleStyle),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  children: [
                    for (final e in execSortLabels.entries)
                      FilterChip(
                        key: ValueKey('exec-sheet-sort-${e.key.name}'),
                        label: Text(e.value),
                        selected: filter.sort == e.key,
                        onSelected: (_) => apply(context, (f) => f.copyWith(sort: e.key)),
                      ),
                  ],
                ),
              ],
            );
          },
        ),
      );
    },
  );
}

/// テーマが属するグループのカテゴリID。候補に無い（非開発テーマ・未選択）なら null
String? _categoryIdOfTheme(List<ThemeCategoryGroup> groups, String? themeId) {
  if (themeId == null) return null;
  for (final group in groups) {
    if (group.themes.any((t) => t.id == themeId)) return group.categoryId;
  }
  return null;
}

/// シートの「カテゴリ」＋「テーマ」セクション。部品はタスク画面と同じ（ChoiceChip / FilterChip＋FilterDotLabel）。
///
/// タスク画面との違いはテーマの先頭に「すべて」があることだけ。選択中のテーマが候補に無い
/// （非開発テーマが選ばれている）ときは、どのテーマチップも選択表示にしない。条件は解除しない。
class ExecThemeFilterSection extends StatelessWidget {
  /// 開発テーマだけのグループ（[execThemeCandidateGroups]）
  final List<ThemeCategoryGroup> groups;

  /// テーマ候補を出しているグループ（groups のどれか）
  final ThemeCategoryGroup selectedGroup;

  /// 適用中のテーマID。null は「すべて」
  final String? selectedThemeId;

  final ValueChanged<ThemeCategoryGroup> onCategorySelected;

  /// テーマを選んだ（null は「すべて」）
  final ValueChanged<String?> onThemeSelected;

  const ExecThemeFilterSection({
    super.key,
    required this.groups,
    required this.selectedGroup,
    required this.selectedThemeId,
    required this.onCategorySelected,
    required this.onThemeSelected,
  });

  static String _groupLabel(ThemeCategoryGroup group) {
    if (group.isUncategorized) return 'その他';
    final name = group.category?.name;
    return name != null && name.isNotEmpty ? name : '不明なカテゴリ';
  }

  @override
  Widget build(BuildContext context) {
    final titleStyle = Theme.of(context).textTheme.titleSmall;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // グループが1つだけならカテゴリで切り替える意味がないので出さない（タスク画面と同じ）
        if (groups.length > 1) ...[
          Text('カテゴリ', style: titleStyle),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final group in groups)
                ChoiceChip(
                  key: ValueKey('exec-sheet-category-${group.categoryId ?? 'none'}'),
                  label: FilterDotLabel(color: group.category?.color, text: _groupLabel(group)),
                  selected: identical(group, selectedGroup),
                  onSelected: (_) => onCategorySelected(group),
                ),
            ],
          ),
          const SizedBox(height: 16),
        ],
        Text('テーマ', style: titleStyle),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            FilterChip(
              key: const ValueKey('exec-sheet-theme-all'),
              label: const Text('すべて'),
              selected: selectedThemeId == null,
              onSelected: (_) => onThemeSelected(null),
            ),
            for (final theme in selectedGroup.themes)
              FilterChip(
                key: ValueKey('exec-sheet-theme-${theme.id}'),
                label: FilterDotLabel(
                  color: theme.color,
                  text: theme.taskCount != null ? '${theme.name}（${theme.taskCount}）' : theme.name,
                ),
                selected: theme.id == selectedThemeId,
                onSelected: (_) => onThemeSelected(theme.id),
              ),
          ],
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}
