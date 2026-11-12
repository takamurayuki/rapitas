import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/task.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/reorder_orders.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/color_dot.dart';
import '../../widgets/default_star_button.dart';
import '../../widgets/voice_mode_indicator.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// テーマ一覧（デスクトップの「テーマ一覧」相当）。カテゴリ→テーマの順に並べ、
/// テーマをタップするとそのテーマで絞り込んだタスク一覧へ移る。
///
/// AppBar からカテゴリ管理・並び替え・テーマ追加ができ、各行の編集アイコンで
/// テーマ編集フォームを開く。
class ThemesScreen extends ConsumerStatefulWidget {
  const ThemesScreen({super.key});

  @override
  ConsumerState<ThemesScreen> createState() => _ThemesScreenState();
}

class _ThemesScreenState extends ConsumerState<ThemesScreen> {
  /// 並び替えモード中の並び（null なら通常モード）
  List<TaskTheme>? _draft;

  /// 並び替えモードで subtitle に出すカテゴリ名（categoryId → 表示名。null キーは「その他」）
  Map<String?, String> _categoryLabels = const {};

  bool _saving = false;

  /// ☆ を設定中のテーマID（二重実行防止）
  String? _settingDefault;

  /// 並び替えモードに入る。カテゴリ順→テーマ順に平坦化した並びを下書きにする
  void _startReorder(List<TaskTheme> themes) {
    final groups = groupThemesByCategory(themes);
    setState(() {
      _draft = [for (final group in groups) ...group.themes];
      _categoryLabels = {
        for (final group in groups) group.categoryId: categoryGroupLabel(group),
      };
    });
  }

  void _cancelReorder() {
    if (_saving) return;
    setState(() => _draft = null);
  }

  void _onReorder(int oldIndex, int newIndex) {
    final draft = _draft;
    if (draft == null) return;
    final moved = moveItem<TaskTheme>(
      draft,
      oldIndex,
      newIndex,
      groupOf: (theme) => theme.categoryId,
    );
    if (moved == null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            content: Text('カテゴリをまたぐ移動はできません（カテゴリは編集画面で変更できます）'),
          ),
        );
      return;
    }
    setState(() => _draft = moved);
  }

  Future<void> _saveReorder() async {
    final draft = _draft;
    if (draft == null || _saving) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);

    try {
      await ref
          .read(themeServiceProvider)
          .reorderThemes([for (final theme in draft) theme.id]);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text('並び順の保存に失敗しました: $e')),
      );
      return;
    }

    container.invalidate(themeListProvider);
    if (!mounted) return;
    setState(() {
      _saving = false;
      _draft = null;
    });
    messenger.showSnackBar(const SnackBar(content: Text('並び順を保存しました')));
  }

  /// フィルターを「このテーマだけ」に置き換えてタスクタブへ移る
  void _openTasks(TaskTheme theme) {
    ref.read(taskFilterProvider.notifier).state = TaskFilter(themeId: theme.id);
    // タスク一覧のシートで選んだのと同じく記憶する（次回起動時の初期選択になる）
    rememberTaskTheme(theme);
    context.go('/tasks');
  }

  /// ☆（そのカテゴリの既定テーマ）にして一覧を取り直す。同じカテゴリの他テーマの ☆ はバックエンドが外す
  Future<void> _setDefault(TaskTheme theme) async {
    if (_settingDefault != null) return;
    setState(() => _settingDefault = theme.id);
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(themeServiceProvider).setDefaultTheme(theme.id);
      container.invalidate(themeListProvider);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('デフォルトの設定に失敗しました: $e')));
    } finally {
      if (mounted) setState(() => _settingDefault = null);
    }
  }

  void _openEdit(TaskTheme theme) {
    context.push('/themes/${theme.id}/edit', extra: theme);
  }

  @override
  Widget build(BuildContext context) {
    final themesAsync = ref.watch(themeListProvider);
    final draft = _draft;

    if (draft != null) {
      return Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          leadingWidth: 104,
          leading: TextButton(
            onPressed: _saving ? null : _cancelReorder,
            child: const Text('キャンセル'),
          ),
          title: const Text('並び替え'),
          actions: [
            const VoiceModeIndicator(trailing: false),
            TextButton(
              onPressed: _saving ? null : _saveReorder,
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('保存'),
            ),
          ],
        ),
        body: VoiceScrollTarget(
          path: '/themes',
          child: ReorderableListView.builder(
            buildDefaultDragHandles: false,
            padding: const EdgeInsets.only(bottom: 16),
            itemCount: draft.length,
            onReorder: _onReorder,
            itemBuilder: (context, index) {
              final theme = draft[index];
              return ListTile(
                key: ValueKey(theme.id),
                leading: ColorDot(color: theme.color),
                minLeadingWidth: 12,
                title: Text(theme.name, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: Text(
                  _categoryLabels[theme.categoryId] ?? '不明なカテゴリ',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                trailing: ReorderableDragStartListener(
                  index: index,
                  enabled: !_saving,
                  child: const Padding(
                    padding: EdgeInsets.all(8),
                    child: Icon(Icons.drag_handle),
                  ),
                ),
              );
            },
          ),
        ),
      );
    }

    final loadedThemes = themesAsync.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('テーマ'),
        actions: [
          const VoiceModeIndicator(trailing: false),
          IconButton(
            icon: const Icon(Icons.folder_outlined),
            tooltip: 'カテゴリ',
            onPressed: () => context.push('/categories'),
          ),
          IconButton(
            icon: const Icon(Icons.swap_vert),
            tooltip: '並び替え',
            onPressed: loadedThemes != null && loadedThemes.length > 1
                ? () => _startReorder(loadedThemes)
                : null,
          ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'テーマを追加',
            onPressed: () => context.push('/themes/new'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: '/themes',
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(themeListProvider);
            try {
              await ref.read(themeListProvider.future);
            } catch (_) {}
          },
          child: themesAsync.when(
            data: (themes) {
              if (themes.isEmpty) {
                return const CenteredMessage(
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
                        onTap: () => _openTasks(theme),
                        onEdit: () => _openEdit(theme),
                        onSetDefault: _settingDefault == null ? () => _setDefault(theme) : null,
                      ),
                  ],
                ],
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
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
      ),
    );
  }
}

/// カテゴリグループの表示名（「その他」／カテゴリ名／「不明なカテゴリ」）
String categoryGroupLabel(ThemeCategoryGroup group) {
  if (group.isUncategorized) return 'その他';
  final name = group.category?.name;
  return name != null && name.isNotEmpty ? name : '不明なカテゴリ';
}

/// カテゴリ見出し（色ドット＋カテゴリ名）
class _CategoryHeading extends StatelessWidget {
  final ThemeCategoryGroup group;

  const _CategoryHeading({required this.group});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Row(
        children: [
          ColorDot(color: group.category?.color, size: 10),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              categoryGroupLabel(group),
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

/// テーマ行（色ドット＋名前＋タスク件数＋☆＋編集アイコン）
class _ThemeTile extends StatelessWidget {
  final TaskTheme theme;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final VoidCallback? onSetDefault;

  const _ThemeTile({
    required this.theme,
    required this.onTap,
    required this.onEdit,
    required this.onSetDefault,
  });

  @override
  Widget build(BuildContext context) {
    final taskCount = theme.taskCount;
    return ListTile(
      leading: ColorDot(color: theme.color),
      minLeadingWidth: 12,
      title: Text(theme.name, maxLines: 1, overflow: TextOverflow.ellipsis),
      subtitle: taskCount != null ? Text('タスク $taskCount件') : null,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          DefaultStarButton(isDefault: theme.isDefault, onSetDefault: onSetDefault),
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'テーマを編集',
            onPressed: onEdit,
          ),
        ],
      ),
      onTap: onTap,
    );
  }
}
