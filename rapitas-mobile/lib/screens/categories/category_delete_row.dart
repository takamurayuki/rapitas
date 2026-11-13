import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../widgets/swipe_to_delete.dart';

// カテゴリ一覧の行の横スワイプ削除（確認ダイアログ→DELETE /categories/:id）。
// categories_screen.dart が行数の上限に近いので、削除の流れはこのファイルに分けている。

/// 削除の確認ダイアログの本文。テーマが消えないことを先に伝える
String categoryDeleteMessage(TaskCategory category) {
  final name = category.name.isNotEmpty ? category.name : '名前なし';
  return '「$name」を削除します。所属するテーマは削除されず「その他」に移ります。';
}

/// カテゴリ行を横スワイプ削除できるようにする包み。
///
/// 初期投入カテゴリ（開発・学習。isDefault）も削除できる。バックエンドの seed は
/// カテゴリが1件も無いときしか投入しないので、削除したものは戻ってこない。
class CategoryDeleteRow extends ConsumerStatefulWidget {
  final TaskCategory category;
  final Widget child;

  const CategoryDeleteRow({super.key, required this.category, required this.child});

  @override
  ConsumerState<CategoryDeleteRow> createState() => _CategoryDeleteRowState();
}

class _CategoryDeleteRowState extends ConsumerState<CategoryDeleteRow> {
  bool _deleting = false;

  /// スワイプし終えた行。一覧の再取得が終わるまで空にしておく（Dismissible は消えた後に木に残せない）
  bool _dismissed = false;

  Future<bool> _confirmAndDelete() async {
    if (_deleting) return false;
    final ok = await confirmBacklogDelete(context, categoryDeleteMessage(widget.category));
    if (!ok || !mounted) return false;
    setState(() => _deleting = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(categoryServiceProvider).deleteCategory(widget.category.id);
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('カテゴリの削除に失敗しました: $e')));
      if (mounted) setState(() => _deleting = false);
      return false;
    }
    return true;
  }

  void _onDismissed() {
    setState(() => _dismissed = true);
    final container = ProviderScope.containerOf(context, listen: false);
    container.invalidate(categoryListProvider);
    // 所属テーマはカテゴリなしになり、☆ だったなら解除されるので、どちらも取り直す
    container.invalidate(themeListProvider);
    container.invalidate(defaultCategoryIdProvider);
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('カテゴリを削除しました')));
  }

  @override
  Widget build(BuildContext context) {
    if (_dismissed) return const SizedBox.shrink();
    return BacklogSwipeToDelete(
      itemKey: ValueKey('category-dismiss-${widget.category.id}'),
      onConfirmDelete: _confirmAndDelete,
      onDismissed: _onDismissed,
      deleting: _deleting,
      child: widget.child,
    );
  }
}
