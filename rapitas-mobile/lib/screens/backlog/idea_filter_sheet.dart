import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/backlog.dart';
import '../../models/task.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/filter_selection.dart';

// アイデア一覧の絞り込みシート（テーマ／優先度／状態／キーワード）と、その表示用の小物

/// 状態フィルターの表示名（null は「すべて」）
const Map<String, String> ideaStatusLabels = {
  'open': '未使用',
  'used': '使用済み',
};

/// テーマ一覧から themeId のテーマ名を引く。一覧が無い・該当が無い・「指定なし」のときは null。
String? ideaThemeName(List<TaskTheme>? themes, String? themeId) {
  if (themes == null || themeId == null || themeId == ideaNoThemeId) return null;
  for (final theme in themes) {
    if (theme.id == themeId) return theme.name.isNotEmpty ? theme.name : null;
  }
  return null;
}

/// 絞り込みシートを開く。「適用」で入力中の条件を、「クリア」でテーマ以外を初期条件に戻して閉じる
/// （どちらもシートで選んでいるテーマを適用し、記憶する）。
Future<void> showIdeaFilterSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    // キーワード欄にフォーカスしたときキーボードの上へシートを持ち上げるため
    isScrollControlled: true,
    builder: (context) => const IdeaFilterSheet(),
  );
}

/// アイデアの絞り込みシート本体。
///
/// タスク一覧のシートは項目を選ぶたびに即適用して閉じるが、こちらはキーワード入力があるため
/// 下書きを持ち、「適用」でまとめて反映する。
class IdeaFilterSheet extends ConsumerStatefulWidget {
  const IdeaFilterSheet({super.key});

  @override
  ConsumerState<IdeaFilterSheet> createState() => _IdeaFilterSheetState();
}

class _IdeaFilterSheetState extends ConsumerState<IdeaFilterSheet> {
  late IdeaFilter _draft;
  late final TextEditingController _searchController;

  @override
  void initState() {
    super.initState();
    _draft = ref.read(ideaFilterProvider);
    _searchController = TextEditingController(text: _draft.search);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _apply() {
    ref.read(ideaFilterProvider.notifier).state =
        _draft.copyWith(search: _searchController.text.trim());
    final themeId = _draft.themeId;
    if (themeId != null) FilterSelectionStore.rememberIdeaTheme(themeId);
    Navigator.pop(context);
  }

  /// NOTE: テーマは常にどれか（または「指定なし」）が選ばれている前提なので、クリアでもテーマは残す。
  /// 残すのはシートで選んでいるテーマ（下書き）で、「適用」と同じく記憶もする
  /// （一覧だけ切り替えて記憶が古いままだと、再起動で前のテーマに戻ってしまうため）。
  void _clear() {
    final themeId = _draft.themeId;
    ref.read(ideaFilterProvider.notifier).state = IdeaFilter(themeId: themeId);
    if (themeId != null) FilterSelectionStore.rememberIdeaTheme(themeId);
    Navigator.pop(context);
  }

  Widget _choices<T>({
    required List<(T?, String)> options,
    required T? selected,
    required ValueChanged<T?> onSelected,
  }) {
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final (value, label) in options)
          FilterChip(
            label: Text(label),
            selected: selected == value,
            onSelected: (_) => onSelected(value),
          ),
      ],
    );
  }

  Widget _themeSection(BuildContext context) {
    final titleStyle = Theme.of(context).textTheme.titleSmall;
    final themesAsync = ref.watch(themeListProvider);
    if (themesAsync.isLoading && !themesAsync.hasValue) {
      return const Padding(
        padding: EdgeInsets.only(bottom: 16),
        child: LinearProgressIndicator(),
      );
    }
    final themes = themesAsync.valueOrNull;
    // 取得失敗・0件ならセクションごと出さない（タスク一覧のシートと同じ方針）
    if (themesAsync.hasError || themes == null || themes.isEmpty) {
      return const SizedBox.shrink();
    }
    final groups = groupThemesByCategory(themes);
    void select(String id) => setState(() => _draft = _draft.copyWith(themeId: id));
    Widget chip(TaskTheme t) => FilterChip(
          label: Text(t.name),
          selected: _draft.themeId == t.id,
          onSelected: (_) => select(t.id),
        );
    final headingStyle = Theme.of(context).textTheme.labelMedium?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
        );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('テーマ', style: titleStyle),
        const SizedBox(height: 8),
        // NOTE: 「すべて」は廃止。「指定なし」はテーマ未定のアイデアだけを出す（GET /idea-box?themeId=none）
        Wrap(spacing: 8, runSpacing: 4, children: [
          FilterChip(
            label: const Text('指定なし'),
            selected: _draft.themeId == ideaNoThemeId,
            onSelected: (_) => select(ideaNoThemeId),
          ),
          // グループが1つならカテゴリ見出しは出さずに並べる
          if (groups.length == 1) for (final t in groups.single.themes) chip(t),
        ]),
        if (groups.length > 1)
          for (final group in groups) ...[
            Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 6),
              child: Text(
                group.isUncategorized
                    ? 'その他'
                    : (group.category?.name.isNotEmpty ?? false)
                        ? group.category!.name
                        : '不明なカテゴリ',
                style: headingStyle,
              ),
            ),
            Wrap(spacing: 8, runSpacing: 4, children: [
              for (final t in group.themes) chip(t),
            ]),
          ],
        const SizedBox(height: 16),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final titleSmall = Theme.of(context).textTheme.titleSmall;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('フィルター', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              _themeSection(context),
              Text('状態', style: titleSmall),
              const SizedBox(height: 8),
              _choices<String>(
                options: [
                  (null, 'すべて'),
                  for (final e in ideaStatusLabels.entries) (e.key, e.value),
                ],
                selected: _draft.status,
                onSelected: (v) => setState(() => _draft = v == null
                    ? _draft.copyWith(clearStatus: true)
                    : _draft.copyWith(status: v)),
              ),
              const SizedBox(height: 16),
              Text('優先度', style: titleSmall),
              const SizedBox(height: 8),
              _choices<String>(
                options: [
                  (null, 'すべて'),
                  for (final e in ideaPriorityLabels.entries) (e.key, e.value),
                ],
                selected: _draft.priority,
                onSelected: (v) => setState(() => _draft = v == null
                    ? _draft.copyWith(clearPriority: true)
                    : _draft.copyWith(priority: v)),
              ),
              const SizedBox(height: 16),
              Text('キーワード', style: titleSmall),
              const SizedBox(height: 8),
              TextField(
                controller: _searchController,
                decoration: const InputDecoration(
                  hintText: 'タイトル・内容で検索',
                  prefixIcon: Icon(Icons.search),
                  border: OutlineInputBorder(),
                  isDense: true,
                ),
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _apply(),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  TextButton(onPressed: _clear, child: const Text('クリア')),
                  const Spacer(),
                  FilledButton(onPressed: _apply, child: const Text('適用')),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
