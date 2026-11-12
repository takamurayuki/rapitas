import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/filter_selection.dart';
import 'task_theme_filter_section.dart';

// タスク一覧のフィルターシート（task_list_screen.dart から分割）

/// タスク一覧のフィルターシートを開く（カテゴリ → テーマ → ステータス → 優先度）。
///
/// テーマ・ステータス・優先度のチップは選ぶと即適用して閉じる。カテゴリは切り替えると
/// そのカテゴリのテーマ（記憶 → ☆ → 先頭）を即適用し、シートは開いたまま。
void showTaskFilterSheet(BuildContext context, WidgetRef ref) {
  final filter = ref.read(taskFilterProvider);

  // カテゴリセクションの選択（シート内の状態。テーマ候補の切り替えに使う）。
  // シートの builder が再実行されても消えないよう、ここで保持する。初期値はテーマ一覧が届いた時点で決める。
  String? selectedCategoryId;

  // NOTE: カテゴリ切替でテーマが即適用されるので、ステータス・優先度は開いた時点ではなく現在の条件に重ねる
  void apply(BuildContext sheetContext, TaskFilter Function(TaskFilter) change) {
    ref.read(taskFilterProvider.notifier).state = change(ref.read(taskFilterProvider));
    Navigator.pop(sheetContext);
  }

  Widget chips(BuildContext sheetContext, String? selected, List<(String?, String)> options,
      TaskFilter Function(TaskFilter, String?) change) {
    return Wrap(
      spacing: 8,
      children: [
        for (final (value, label) in options)
          FilterChip(
            label: Text(label),
            selected: selected == value,
            onSelected: (_) => apply(sheetContext, (f) => change(f, value)),
          ),
      ],
    );
  }

  showModalBottomSheet(
    context: context,
    builder: (context) {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('フィルター', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            // カテゴリ → テーマ（デスクトップと同じ並び）。この後にステータス・優先度が続く
            Consumer(
              builder: (context, ref, _) {
                final themesAsync = ref.watch(themeListProvider);
                if (themesAsync.isLoading && !themesAsync.hasValue) {
                  return const Padding(
                    padding: EdgeInsets.only(bottom: 16),
                    child: LinearProgressIndicator(),
                  );
                }
                final themes = themesAsync.valueOrNull;
                // NOTE: categoryId が null のテーマは候補に出さない（カテゴリ削除時だけ生じる例外状態。PC で再割り当てする想定）
                final groups = themesAsync.hasError || themes == null
                    ? const <ThemeCategoryGroup>[]
                    : [for (final g in groupThemesByCategory(themes)) if (!g.isUncategorized) g];
                // 取得失敗・候補0件ならセクションごと出さない（フォーム画面のテーマ欄と同じ方針）
                if (groups.isEmpty) return const SizedBox.shrink();
                final currentThemeId = ref.watch(taskFilterProvider).themeId;
                final categoryId = selectedCategoryId ??= _categoryIdOfTheme(groups, currentThemeId) ??
                    ref.read(taskInitialSelectionProvider).valueOrNull?.categoryId;
                return StatefulBuilder(
                  builder: (context, setSheetState) {
                    return TaskThemeFilterSection(
                      groups: groups,
                      selectedCategoryId: groups.any((g) => g.categoryId == categoryId)
                          ? categoryId!
                          : groups.first.categoryId!,
                      selectedThemeId: currentThemeId,
                      onCategorySelected: (id) async {
                        setSheetState(() => selectedCategoryId = id);
                        // カテゴリを切り替えたら、そのカテゴリの記憶 → ☆ → 先頭のテーマを即適用する
                        // （「選ばれていないカテゴリ」の状態を作らない）。シートは開いたまま
                        final memory = await FilterSelectionStore.loadTask();
                        final themeId =
                            resolveThemeForCategory(categoryId: id, themes: themes!, memory: memory);
                        if (themeId == null) return;
                        ref.read(taskFilterProvider.notifier).state =
                            ref.read(taskFilterProvider).copyWith(themeId: themeId);
                        await FilterSelectionStore.rememberTaskTheme(categoryId: id, themeId: themeId);
                      },
                      onThemeSelected: (theme) {
                        rememberTaskTheme(theme);
                        apply(context, (f) => f.copyWith(themeId: theme.id));
                      },
                    );
                  },
                );
              },
            ),
            Text('ステータス', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            chips(
              context,
              filter.status,
              const [(null, 'すべて'), ('todo', '未着手'), ('in-progress', '進行中'), ('done', '完了')],
              (f, v) => v == null ? f.copyWith(clearStatus: true) : f.copyWith(status: v),
            ),
            const SizedBox(height: 16),
            Text('優先度', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            chips(
              context,
              filter.priority,
              const [(null, 'すべて'), ('urgent', '緊急'), ('high', '高'), ('medium', '中'), ('low', '低')],
              (f, v) => v == null ? f.copyWith(clearPriority: true) : f.copyWith(priority: v),
            ),
          ],
        ),
      );
    },
  );
}

/// テーマが属するカテゴリのIDを返す。見つからなければ null
String? _categoryIdOfTheme(List<ThemeCategoryGroup> groups, String? themeId) {
  if (themeId == null) return null;
  for (final group in groups) {
    if (group.themes.any((t) => t.id == themeId)) return group.categoryId;
  }
  return null;
}
