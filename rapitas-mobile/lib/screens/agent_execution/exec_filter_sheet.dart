import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/theme_data_provider.dart';
import '../task_list/task_theme_filter_section.dart' show FilterDotLabel;
import 'exec_filter.dart';

// 実行画面のフィルターシート（テーマ → 状態 → 並び順）。見た目はタスク画面の
// task_filter_sheet.dart にそろえる。条件の中身と適用は exec_filter.dart のまま変えない。
// NOTE: どのチップもタップで即適用するだけで、シートは閉じない（nav73: 状態・並び順を選ぶと閉じて、
// 条件を組み合わせるのに開き直しが要った）。閉じるのは下部の「完了」とバリアのタップ・下スワイプだけ。
// タスク画面のシートの閉じ方はこれとは別で、変えていない。

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
/// テーマ（複数選択）・状態・並び順のどのチップも、タップで即適用してシートは開いたままにする。
/// テーマ → 状態 → 並び順と1回のシートで続けて選べ、閉じるのは下部の「完了」とバリアのタップ・下スワイプだけ
/// （条件はタップの時点で適用済みなので、どの閉じ方でも同じ）。
/// カテゴリはテーマ候補を切り替えるだけで、条件には触れない（実行画面には「すべて」があり、
/// タスク画面の「常に1テーマ必須」は持ち込まない）。
///
/// @param context - context to show the sheet from / シートを出す元の context
/// @param ref - ref of the executions screen / 実行画面の ref
void showExecFilterSheet(BuildContext context, WidgetRef ref) {
  // カテゴリの選択はシート内だけの状態。builder が再実行されても消えないようここで持つ
  ({String? id})? selectedCategory;

  void update(ExecFilter Function(ExecFilter) change) {
    final notifier = ref.read(execFilterProvider.notifier);
    notifier.state = change(notifier.state);
  }

  showModalBottomSheet<void>(
    context: context,
    builder: (context) {
      // NOTE: Material 3 のボトムシートは子を Align で包むため、チップが1行に満たないとシート面が中身の幅まで
      // 縮む（nav71: 実行画面のシートが画面より狭く見えた原因）。タスク画面・実行画面とも幅いっぱいに固定する
      return SizedBox(
        width: double.infinity,
        child: SingleChildScrollView(
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
                        // NOTE: グループで受ける。カテゴリIDの null は「その他」グループの正当な値なので、
                        // ID の null を「該当なし」と見なして先頭へ置き換えてはいけない
                        selectedCategory ??= (id: (_groupOfThemes(groups, filter.themeIds) ?? groups.first).categoryId);
                        final current = selectedCategory!.id;
                        return ExecThemeFilterSection(
                          groups: groups,
                          selectedGroup: groups.firstWhere((g) => g.categoryId == current, orElse: () => groups.first),
                          selectedThemeIds: filter.themeIds,
                          onCategorySelected: (group) => setSheetState(() => selectedCategory = (id: group.categoryId)),
                          onThemeToggled: (id) =>
                              update((f) => id == null ? f.copyWith(themeIds: const {}) : f.toggleTheme(id)),
                        );
                      },
                    ),
                  Text('状態', style: titleStyle),
                  // 状態の効き先は exec_filter.dart（実行中リストと自動実行カード。再開可能には効かない）
                  Text(
                    '実行中のリストと自動実行に効きます',
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
                          onSelected: (_) => update((f) => f.copyWith(status: e.key)),
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
                          onSelected: (_) => update((f) => f.copyWith(sort: e.key)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // どのチップも選んでも閉じないので、閉じる操作をはっきり置く
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      key: const ValueKey('exec-sheet-done'),
                      onPressed: () => Navigator.pop(context),
                      child: const Text('完了'),
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      );
    },
  );
}

/// 選択中のテーマを含む最初のグループ。どれも候補に無い（非開発テーマ・未選択）なら null
ThemeCategoryGroup? _groupOfThemes(List<ThemeCategoryGroup> groups, Set<String> themeIds) {
  if (themeIds.isEmpty) return null;
  for (final group in groups) {
    if (group.themes.any((t) => themeIds.contains(t.id))) return group;
  }
  return null;
}

/// シートの「カテゴリ」＋「テーマ」セクション。部品はタスク画面と同じ（ChoiceChip / FilterChip＋FilterDotLabel）。
///
/// タスク画面との違いは、テーマの先頭に「すべて」があることと、テーマが複数選択であること。
/// 選択中のテーマが候補に無い（非開発テーマが選ばれている）ときは、そのチップは出ない。条件は解除しない。
class ExecThemeFilterSection extends StatelessWidget {
  /// 開発テーマだけのグループ（[execThemeCandidateGroups]）
  final List<ThemeCategoryGroup> groups;

  /// テーマ候補を出しているグループ（groups のどれか）
  final ThemeCategoryGroup selectedGroup;

  /// 適用中のテーマIDの集合。空は「すべて」
  final Set<String> selectedThemeIds;

  final ValueChanged<ThemeCategoryGroup> onCategorySelected;

  /// テーマチップをタップした（null は「すべて」＝選択を空にする。それ以外は選択/解除の切り替え）
  final ValueChanged<String?> onThemeToggled;

  const ExecThemeFilterSection({
    super.key,
    required this.groups,
    required this.selectedGroup,
    required this.selectedThemeIds,
    required this.onCategorySelected,
    required this.onThemeToggled,
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
              selected: selectedThemeIds.isEmpty,
              onSelected: (_) => onThemeToggled(null),
            ),
            for (final theme in selectedGroup.themes)
              FilterChip(
                key: ValueKey('exec-sheet-theme-${theme.id}'),
                label: FilterDotLabel(
                  color: theme.color,
                  text: theme.taskCount != null ? '${theme.name}（${theme.taskCount}）' : theme.name,
                ),
                selected: selectedThemeIds.contains(theme.id),
                onSelected: (_) => onThemeToggled(theme.id),
              ),
          ],
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}
