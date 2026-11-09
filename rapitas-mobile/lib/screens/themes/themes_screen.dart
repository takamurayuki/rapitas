import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../utils/color_utils.dart';

/// テーマ一覧（デスクトップの「テーマ一覧」相当）。カテゴリ→テーマの順に並べ、
/// テーマをタップするとそのテーマで絞り込んだタスク一覧へ移る。
class ThemesScreen extends ConsumerWidget {
  const ThemesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themesAsync = ref.watch(themeListProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('テーマ')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(themeListProvider),
        child: themesAsync.when(
          data: (themes) {
            if (themes.isEmpty) {
              return const _CenteredMessage(
                icon: Icons.palette_outlined,
                message: 'テーマはありません',
              );
            }
            final groups = groupThemesByCategory(themes);
            return ListView(
              padding: const EdgeInsets.only(bottom: 16),
              children: [
                for (final group in groups) ...[
                  _CategoryHeading(group: group),
                  for (final theme in group.themes)
                    _ThemeTile(
                      theme: theme,
                      onTap: () => _openTasks(context, ref, theme),
                    ),
                ],
              ],
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (_, __) => _CenteredMessage(
            icon: Icons.error_outline,
            iconColor: Colors.red,
            message: 'テーマの取得に失敗しました',
            action: ElevatedButton(
              onPressed: () => ref.invalidate(themeListProvider),
              child: const Text('再試行'),
            ),
          ),
        ),
      ),
    );
  }

  /// フィルターを「このテーマだけ」に置き換えてタスクタブへ移る
  void _openTasks(BuildContext context, WidgetRef ref, TaskTheme theme) {
    ref.read(taskFilterProvider.notifier).state = TaskFilter(themeId: theme.id);
    // NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く
    context.go('/tasks');
  }
}

/// 色ドット（色がパースできなければグレー）
class _ColorDot extends StatelessWidget {
  final String? color;
  final double size;

  const _ColorDot({required this.color, this.size = 12});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: ColorUtils.parseColor(color) ?? Colors.grey,
        shape: BoxShape.circle,
      ),
    );
  }
}

/// カテゴリ見出し（色ドット＋カテゴリ名）
class _CategoryHeading extends StatelessWidget {
  final ThemeCategoryGroup group;

  const _CategoryHeading({required this.group});

  String get _label {
    if (group.isUncategorized) return 'その他';
    final name = group.category?.name;
    return name != null && name.isNotEmpty ? name : '不明なカテゴリ';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Row(
        children: [
          _ColorDot(color: group.category?.color, size: 10),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _label,
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

/// テーマ行（色ドット＋名前＋タスク件数＋シェブロン）
class _ThemeTile extends StatelessWidget {
  final TaskTheme theme;
  final VoidCallback onTap;

  const _ThemeTile({required this.theme, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final taskCount = theme.taskCount;
    return ListTile(
      leading: _ColorDot(color: theme.color),
      minLeadingWidth: 12,
      title: Text(theme.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: taskCount != null ? Text('タスク $taskCount件') : null,
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}

/// 空・エラーのときの中央表示。引っ張って更新できるようスクロール可能にしてある。
class _CenteredMessage extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String message;
  final Widget? action;

  const _CenteredMessage({
    required this.icon,
    required this.message,
    this.iconColor = Colors.grey,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(icon, size: 64, color: iconColor),
                    const SizedBox(height: 16),
                    Text(message, textAlign: TextAlign.center),
                    if (action != null) ...[
                      const SizedBox(height: 16),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
