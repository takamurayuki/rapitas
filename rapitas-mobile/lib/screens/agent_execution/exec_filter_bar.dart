import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/theme_data_provider.dart';
import 'exec_filter.dart';

/// 実行画面上部の絞り込みバー（文字検索・テーマ・並び順・状態・クリア）。
/// 条件は [execFilterProvider] に置き、画面を離れても保持する
class ExecFilterBar extends ConsumerStatefulWidget {
  const ExecFilterBar({super.key});

  @override
  ConsumerState<ExecFilterBar> createState() => _ExecFilterBarState();
}

class _ExecFilterBarState extends ConsumerState<ExecFilterBar> {
  late final TextEditingController _query =
      TextEditingController(text: ref.read(execFilterProvider).query);

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _update(ExecFilter Function(ExecFilter) change) {
    final notifier = ref.read(execFilterProvider.notifier);
    notifier.state = change(notifier.state);
  }

  @override
  Widget build(BuildContext context) {
    // クリア操作（空表示のボタンなど）で条件が外から戻されたら入力欄も合わせる
    ref.listen<ExecFilter>(execFilterProvider, (_, next) {
      if (_query.text != next.query) _query.text = next.query;
    });
    final filter = ref.watch(execFilterProvider);
    final themes = ref.watch(themeListProvider).valueOrNull ?? const <TaskTheme>[];

    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const ValueKey('exec-filter-search'),
            controller: _query,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              isDense: true,
              hintText: 'タスク名・テーマ名で検索',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: filter.hasQuery
                  ? IconButton(
                      tooltip: '検索語を消す',
                      icon: const Icon(Icons.close),
                      onPressed: () => _update((f) => f.copyWith(query: '')),
                    )
                  : null,
              border: const OutlineInputBorder(),
            ),
            onChanged: (text) => _update((f) => f.copyWith(query: text)),
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              _ThemeMenu(
                themes: themes,
                selectedId: filter.themeId,
                onSelected: (id) =>
                    _update((f) => id == null ? f.copyWith(clearThemeId: true) : f.copyWith(themeId: id)),
              ),
              _StatusMenu(
                selected: filter.status,
                onSelected: (s) => _update((f) => f.copyWith(status: s)),
              ),
              ActionChip(
                key: const ValueKey('exec-filter-sort'),
                avatar: Icon(filter.sort == ExecSort.newest ? Icons.arrow_downward : Icons.arrow_upward, size: 18),
                label: Text(filter.sort == ExecSort.newest ? '新しい順' : '古い順'),
                tooltip: '並び順を切り替え',
                onPressed: () => _update((f) =>
                    f.copyWith(sort: f.sort == ExecSort.newest ? ExecSort.oldest : ExecSort.newest)),
              ),
              if (!filter.isDefault)
                TextButton.icon(
                  key: const ValueKey('exec-filter-clear'),
                  icon: const Icon(Icons.filter_alt_off_outlined, size: 18),
                  label: const Text('条件をクリア'),
                  onPressed: () => clearExecFilter(ref),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// 絞り込み条件をまとめて既定（絞り込みなし・新しい順）に戻す
void clearExecFilter(WidgetRef ref) {
  ref.read(execFilterProvider.notifier).state = const ExecFilter();
}

/// 選択中なら色つきの外枠で目立たせるチップ（テーマ・状態のメニューで共通）
class _MenuChip extends StatelessWidget {
  final String label;
  final bool active;

  const _MenuChip({required this.label, required this.active});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Chip(
      label: Row(mainAxisSize: MainAxisSize.min, children: [
        Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
        const Icon(Icons.arrow_drop_down, size: 18),
      ]),
      backgroundColor: active ? colorScheme.secondaryContainer : null,
      side: BorderSide(color: active ? colorScheme.secondary : colorScheme.outlineVariant),
    );
  }
}

class _ThemeMenu extends StatelessWidget {
  final List<TaskTheme> themes;
  final String? selectedId;
  final ValueChanged<String?> onSelected;

  const _ThemeMenu({required this.themes, required this.selectedId, required this.onSelected});

  static const _all = '';

  @override
  Widget build(BuildContext context) {
    final selected = themes.where((t) => t.id == selectedId).firstOrNull;
    // 選択中のテーマが一覧から消えても（削除・取得前）条件は残るので、その旨を名前の代わりに出す
    final name = selectedId == null ? 'すべて' : (selected?.name ?? '選択中のテーマ');
    return PopupMenuButton<String>(
      key: const ValueKey('exec-filter-theme'),
      tooltip: 'テーマで絞り込む',
      onSelected: (id) => onSelected(id == _all ? null : id),
      itemBuilder: (_) => [
        CheckedPopupMenuItem(value: _all, checked: selectedId == null, child: const Text('すべて')),
        for (final t in themes)
          CheckedPopupMenuItem(value: t.id, checked: t.id == selectedId, child: Text(t.name)),
      ],
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 220),
        child: _MenuChip(label: 'テーマ: $name', active: selectedId != null),
      ),
    );
  }
}

class _StatusMenu extends StatelessWidget {
  final ExecStatusFilter selected;
  final ValueChanged<ExecStatusFilter> onSelected;

  const _StatusMenu({required this.selected, required this.onSelected});

  static const _labels = {
    ExecStatusFilter.all: 'すべて',
    ExecStatusFilter.running: '実行中',
    ExecStatusFilter.waitingForInput: '入力待ち',
  };

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<ExecStatusFilter>(
      key: const ValueKey('exec-filter-status'),
      tooltip: '実行中リストの状態で絞り込む',
      onSelected: onSelected,
      itemBuilder: (_) => [
        for (final e in _labels.entries)
          CheckedPopupMenuItem(value: e.key, checked: e.key == selected, child: Text(e.value)),
      ],
      child: _MenuChip(label: '状態: ${_labels[selected]}', active: selected != ExecStatusFilter.all),
    );
  }
}
