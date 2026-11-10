import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/task.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/reorder_orders.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/color_dot.dart';
import 'category_form_screen.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';

// NOTE: パスは AppRoutes.categories と同じ値（routes.dart との import の循環を避けて文字列で持つ）
const String _path = '/categories';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// カテゴリを sortOrder 昇順に並べる（sortOrder が無いものは後ろ。同値は元の順）
List<TaskCategory> sortCategoriesByOrder(List<TaskCategory> categories) {
  final indexed = [
    for (var i = 0; i < categories.length; i++) (index: i, category: categories[i]),
  ];
  indexed.sort((a, b) {
    final sa = a.category.sortOrder;
    final sb = b.category.sortOrder;
    if (sa != null && sb != null && sa != sb) return sa.compareTo(sb);
    if (sa != null && sb == null) return -1;
    if (sa == null && sb != null) return 1;
    return a.index.compareTo(b.index);
  });
  return [for (final entry in indexed) entry.category];
}

/// カテゴリ管理（一覧・並び替え・追加・編集）
class CategoriesScreen extends ConsumerStatefulWidget {
  const CategoriesScreen({super.key});

  @override
  ConsumerState<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends ConsumerState<CategoriesScreen> {
  /// 並び替えモード中の並び（null なら通常モード）
  List<TaskCategory>? _draft;
  bool _saving = false;

  void _startReorder(List<TaskCategory> categories) {
    setState(() => _draft = sortCategoriesByOrder(categories));
  }

  void _cancelReorder() {
    if (_saving) return;
    setState(() => _draft = null);
  }

  void _onReorder(int oldIndex, int newIndex) {
    final draft = _draft;
    if (draft == null) return;
    final moved = moveItem<TaskCategory>(draft, oldIndex, newIndex);
    if (moved == null) return;
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
          .read(categoryServiceProvider)
          .reorderCategories([for (final category in draft) category.id]);
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text('並び順の保存に失敗しました: $e')),
      );
      return;
    }

    container.invalidate(categoryListProvider);
    // テーマ画面のグループ順はカテゴリの sortOrder で決まるので取り直す
    container.invalidate(themeListProvider);
    if (!mounted) return;
    setState(() {
      _saving = false;
      _draft = null;
    });
    messenger.showSnackBar(const SnackBar(content: Text('並び順を保存しました')));
  }

  void _openEdit(TaskCategory category) {
    context.push('/categories/${category.id}/edit', extra: category);
  }

  @override
  Widget build(BuildContext context) {
    final categoriesAsync = ref.watch(categoryListProvider);
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
          path: _path,
          child: ReorderableListView.builder(
            buildDefaultDragHandles: false,
            padding: const EdgeInsets.only(bottom: 16),
            itemCount: draft.length,
            onReorder: _onReorder,
            itemBuilder: (context, index) {
              final category = draft[index];
              return _CategoryTile(
                key: ValueKey(category.id),
                category: category,
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

    final loaded = categoriesAsync.valueOrNull;
    return Scaffold(
      appBar: AppBar(
        title: const Text('カテゴリ'),
        actions: [
          const VoiceModeIndicator(trailing: false),
          IconButton(
            icon: const Icon(Icons.swap_vert),
            tooltip: '並び替え',
            onPressed: loaded != null && loaded.length > 1
                ? () => _startReorder(loaded)
                : null,
          ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'カテゴリを追加',
            onPressed: () => context.push('/categories/new'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: _path,
        child: RefreshIndicator(
          onRefresh: () async => ref.invalidate(categoryListProvider),
          child: categoriesAsync.when(
            data: (categories) {
              if (categories.isEmpty) {
                return const CenteredMessage(
                  icon: Icons.folder_outlined,
                  message: 'カテゴリはありません',
                );
              }
              final sorted = sortCategoriesByOrder(categories);
              return ListView(
                padding: const EdgeInsets.only(bottom: 16),
                children: [
                  for (final category in sorted)
                    _CategoryTile(
                      category: category,
                      trailing: IconButton(
                        icon: const Icon(Icons.edit_outlined),
                        tooltip: 'カテゴリを編集',
                        onPressed: () => _openEdit(category),
                      ),
                      onTap: () => _openEdit(category),
                    ),
                ],
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
              icon: Icons.error_outline,
              iconColor: Colors.red,
              message: 'カテゴリの取得に失敗しました',
              action: ElevatedButton(
                onPressed: () => ref.invalidate(categoryListProvider),
                child: const Text('再試行'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// カテゴリ行（色ドット＋名前＋テーマ件数＋モードのラベル）
class _CategoryTile extends StatelessWidget {
  final TaskCategory category;
  final Widget trailing;
  final VoidCallback? onTap;

  const _CategoryTile({
    super.key,
    required this.category,
    required this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final themeCount = category.themeCount;
    final modeLabel = categoryModeLabels[category.mode];
    return ListTile(
      leading: ColorDot(color: category.color),
      minLeadingWidth: 12,
      title: Row(
        children: [
          Flexible(
            child: Text(
              category.name.isNotEmpty ? category.name : '名前なし',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (modeLabel != null) ...[
            const SizedBox(width: 8),
            _ModeLabel(label: modeLabel),
          ],
        ],
      ),
      subtitle: themeCount != null ? Text('テーマ $themeCount件') : null,
      trailing: trailing,
      onTap: onTap,
    );
  }
}

/// モードの小さなラベル（開発／学習／両方）
class _ModeLabel extends StatelessWidget {
  final String label;

  const _ModeLabel({required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
