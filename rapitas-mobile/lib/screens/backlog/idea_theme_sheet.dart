import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/backlog.dart';
import '../../models/task.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/filter_selection.dart';
import '../../widgets/color_dot.dart';

// アイデア行をタップしたときの操作シート（テーマの変更）と、テーマ選択リスト

/// カテゴリ見出しの表示名（テーマ画面・フィルターシートと同じ）
String _groupLabel(ThemeCategoryGroup group) {
  if (group.isUncategorized) return 'その他';
  final name = group.category?.name;
  return name != null && name.isNotEmpty ? name : '不明なカテゴリ';
}

/// アイデアの操作シートを開く。いまは「テーマを変更」だけ（削除は行の横スワイプ）。
///
/// テーマを変えたら PATCH /idea-box/:id で保存し、一覧を取り直す。
///
/// @param context - 画面の BuildContext
/// @param idea - 対象のアイデア
Future<void> showIdeaActionsSheet(BuildContext context, Idea idea) async {
  final container = ProviderScope.containerOf(context, listen: false);
  final messenger = ScaffoldMessenger.of(context);
  final themes = container.read(themeListProvider).valueOrNull ?? const <TaskTheme>[];
  final current = idea.themeId ?? ideaNoThemeId;
  String? currentName;
  for (final t in themes) {
    if (t.id == idea.themeId) currentName = t.name;
  }

  final action = await showModalBottomSheet<String>(
    context: context,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              idea.title.isNotEmpty ? idea.title : '（無題）',
              style: Theme.of(context).textTheme.titleMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          ListTile(
            leading: const Icon(Icons.folder),
            title: const Text('テーマを変更'),
            subtitle: Text('現在：${currentName ?? '指定なし'}'),
            enabled: themes.isNotEmpty,
            onTap: () => Navigator.pop(context, 'theme'),
          ),
        ],
      ),
    ),
  );
  if (action != 'theme' || !context.mounted) return;

  final picked = await showIdeaThemePicker(context, themes: themes, current: current);
  if (picked == null || picked == current) return;
  try {
    await container
        .read(backlogServiceProvider)
        .updateIdeaTheme(idea.id, picked == ideaNoThemeId ? null : picked);
  } catch (e) {
    messenger.showSnackBar(SnackBar(content: Text('テーマの変更に失敗しました: $e')));
    return;
  }
  container.invalidate(ideaListProvider);
  messenger.showSnackBar(const SnackBar(content: Text('テーマを変更しました')));
}

/// テーマ選択リスト（「指定なし」＋カテゴリ見出しごとのテーマ）をボトムシートで出す。
///
/// @param themes - テーマ一覧
/// @param current - 現在のテーマID または [ideaNoThemeId]（チェックを付ける）
/// @returns 選んだテーマID または [ideaNoThemeId]。閉じただけなら null
Future<String?> showIdeaThemePicker(
  BuildContext context, {
  required List<TaskTheme> themes,
  required String current,
}) {
  final groups = groupThemesByCategory(themes);
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    builder: (context) {
      final theme = Theme.of(context);
      Widget option(String value, Widget leading, String label) => ListTile(
            leading: leading,
            minLeadingWidth: 12,
            title: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
            trailing: value == current ? Icon(Icons.check, color: theme.colorScheme.primary) : null,
            selected: value == current,
            onTap: () => Navigator.pop(context, value),
          );
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
        child: SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text('テーマを選択', style: theme.textTheme.titleMedium),
              ),
              option(ideaNoThemeId, const Icon(Icons.remove_circle_outline, size: 18), '指定なし'),
              for (final group in groups) ...[
                // グループが1つならカテゴリ見出しは出さない（フィルターシートと同じ）
                if (groups.length > 1)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                    child: Text(
                      _groupLabel(group),
                      style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                for (final t in group.themes) option(t.id, ColorDot(color: t.color), t.name),
              ],
            ],
          ),
        ),
      );
    },
  );
}
