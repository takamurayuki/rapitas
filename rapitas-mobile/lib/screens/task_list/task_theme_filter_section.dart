import 'package:flutter/material.dart';

import '../../models/task.dart';
import '../../utils/color_utils.dart';

// タスク一覧のフィルターシートの「カテゴリ」＋「テーマ」セクション（task_list_screen.dart から分割）。
//
// NOTE: 「すべて」（カテゴリ）と「指定なし」（テーマ）は廃止した。常にどれか1つのカテゴリと
// テーマが選ばれた状態にする（初期値は filter_selection.dart の解決：記憶 → ☆ → 並び順の先頭）。

/// カテゴリ選択でテーマ候補を切り替え、テーマチップで適用する。
///
/// [groups] はカテゴリに属するテーマのグループだけを渡す（カテゴリなしのテーマは候補外）。
class TaskThemeFilterSection extends StatelessWidget {
  final List<ThemeCategoryGroup> groups;

  /// 選択中カテゴリのID（groups のどれか）
  final String selectedCategoryId;

  /// 適用中のテーマID
  final String? selectedThemeId;

  final ValueChanged<String> onCategorySelected;
  final ValueChanged<TaskTheme> onThemeSelected;

  const TaskThemeFilterSection({
    super.key,
    required this.groups,
    required this.selectedCategoryId,
    required this.selectedThemeId,
    required this.onCategorySelected,
    required this.onThemeSelected,
  });

  static String _groupLabel(ThemeCategoryGroup group) {
    final name = group.category?.name;
    return name != null && name.isNotEmpty ? name : '不明なカテゴリ';
  }

  Widget _themeChip(TaskTheme theme) {
    return FilterChip(
      label: FilterDotLabel(
        color: theme.color,
        text: theme.taskCount != null ? '${theme.name}（${theme.taskCount}）' : theme.name,
      ),
      selected: theme.id == selectedThemeId,
      onSelected: (_) => onThemeSelected(theme),
    );
  }

  @override
  Widget build(BuildContext context) {
    final titleStyle = Theme.of(context).textTheme.titleSmall;
    // グループが1つだけならカテゴリで切り替える意味がないのでカテゴリセクションは出さない
    final showCategories = groups.length > 1;
    final selectedGroup = groups.firstWhere(
      (g) => g.categoryId == selectedCategoryId,
      orElse: () => groups.first,
    );

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showCategories) ...[
          Text('カテゴリ', style: titleStyle),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              for (final group in groups)
                ChoiceChip(
                  label: FilterDotLabel(color: group.category?.color, text: _groupLabel(group)),
                  selected: identical(group, selectedGroup),
                  onSelected: (_) => onCategorySelected(group.categoryId!),
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
          children: [for (final t in selectedGroup.themes) _themeChip(t)],
        ),
        const SizedBox(height: 16),
      ],
    );
  }
}

/// 色ドット＋テキストのチップラベル。色がパースできなければテキストのみ。
class FilterDotLabel extends StatelessWidget {
  final String? color;
  final String text;

  const FilterDotLabel({super.key, required this.color, required this.text});

  @override
  Widget build(BuildContext context) {
    final dotColor = ColorUtils.parseColor(color);
    if (dotColor == null) return Text(text);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(text),
      ],
    );
  }
}
