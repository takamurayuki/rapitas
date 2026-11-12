import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/backlog.dart';
import '../../models/task.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../providers/backlog_provider.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/filter_selection.dart';
import '../../widgets/centered_message.dart';
import 'backlog_widgets.dart';
import 'idea_filter_sheet.dart';
import 'idea_theme_sheet.dart';
import '../../widgets/voice_mode_indicator.dart';

// NOTE: routes.dart がこの画面を import しているので、循環を避けてパスは文字列で書く

/// アイデア一覧（先頭100件）。テーマ・優先度・状態・キーワードで絞り込め、追加ができる。
/// テーマは常にどれか（または「指定なし」）が選ばれている（初期値は記憶 → ☆ → 先頭）。
/// 行タップでテーマを変更でき、削除は行の横スワイプ（右から左）＋確認ダイアログ。
class IdeasScreen extends ConsumerStatefulWidget {
  const IdeasScreen({super.key});

  @override
  ConsumerState<IdeasScreen> createState() => _IdeasScreenState();
}

class _IdeasScreenState extends ConsumerState<IdeasScreen> {
  /// 削除リクエスト中のアイデアID（二重実行防止）
  final Set<String> _deleting = {};

  /// スワイプで消えた行のID。再取得の結果が届くまで一覧から外しておく
  /// （Dismissible は消えた後も木に残るとエラーになるため）。
  final Set<String> _dismissed = {};

  @override
  void initState() {
    super.initState();
    // テーマ一覧が届いたら一度だけ、記憶 → ☆ → 先頭 で解決したテーマを絞り込みに入れる
    // NOTE: build 中にプロバイダーを書き換えられないので microtask へ逃がす
    ref.listenManual<AsyncValue<String?>>(
      ideaInitialSelectionProvider,
      (_, next) => Future.microtask(() {
        if (mounted) applyInitialIdeaSelection(ref.read, next);
      }),
      fireImmediately: true,
    );
  }

  /// スワイプ削除の確認→削除。削除できたら true（行が消える）、
  /// キャンセル・失敗・実行中なら false（行はスワイプ前に戻る）。
  Future<bool> _delete(Idea idea) async {
    if (_deleting.contains(idea.id)) return false;
    final ok = await confirmBacklogDelete(
      context,
      '「${idea.title}」を削除します。元に戻せません。',
    );
    if (!ok || !mounted) return false;

    setState(() => _deleting.add(idea.id));
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(backlogServiceProvider).deleteIdea(idea.id);
    } catch (e) {
      if (mounted) setState(() => _deleting.remove(idea.id));
      messenger.showSnackBar(SnackBar(content: Text('アイデアの削除に失敗しました: $e')));
      return false;
    }
    container.invalidate(ideaListProvider);
    if (mounted) setState(() => _deleting.remove(idea.id));
    messenger.showSnackBar(const SnackBar(content: Text('アイデアを削除しました')));
    return true;
  }

  void _setFilter(IdeaFilter filter) {
    ref.read(ideaFilterProvider.notifier).state = filter;
  }

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(ideaFilterProvider);
    // NOTE: テーマは常に選ばれているので、Badge・解除ボタンの対象はテーマ以外の条件だけ
    final isFiltered = filter.hasExtraConditions;
    // 初期選択（テーマ）が決まるまでは全件を取りに行かない（全件→テーマの順に表示が切り替わるのを防ぐ）
    final waiting = ref.watch(ideaSelectionPendingProvider) && filter.themeId == null;
    final ideasAsync = waiting ? const AsyncLoading<List<Idea>>() : ref.watch(ideaListProvider);
    // 行のテーマ名・チップのラベル用。取れなければテーマ名は出さないだけで一覧は表示する
    final themes = ref.watch(themeListProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('アイデア'),
        actions: [
          const VoiceModeIndicator(trailing: false),
          IconButton(
            icon: Badge(
              isLabelVisible: isFiltered,
              child: const Icon(Icons.filter_list),
            ),
            tooltip: 'フィルター',
            onPressed: () => showIdeaFilterSheet(context),
          ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'アイデアを追加',
            onPressed: () => context.push('/ideas/new'),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: '/ideas',
        child: Column(
          children: [
            if (isFiltered || filter.themeId != null) _buildActiveFilterChips(filter, themes),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  // 一覧は ideaFilterProvider を watch しているので、条件を保ったまま取り直す
                  ref.invalidate(ideaListProvider);
                  // テーマ一覧の取得に失敗していたら取り直す（成功すれば初期選択がここで一度だけ入る）
                  if (ref.read(themeListProvider).hasError) ref.invalidate(themeListProvider);
                  try {
                    await ref.read(ideaListProvider.future);
                  } catch (_) {}
                },
                child: ideasAsync.when(
                  data: (fetched) {
                    final ideas = fetched.where((i) => !_dismissed.contains(i.id)).toList();
                    if (ideas.isEmpty) {
                      return isFiltered
                          ? CenteredMessage(
                              icon: Icons.filter_alt_off,
                              message: '条件に合うアイデアはありません',
                              action: OutlinedButton.icon(
                                onPressed: () => _setFilter(IdeaFilter(themeId: filter.themeId)),
                                icon: const Icon(Icons.filter_alt_off),
                                label: const Text('フィルターを解除'),
                              ),
                            )
                          : const CenteredMessage(
                              icon: Icons.lightbulb_outline,
                              message: 'アイデアはありません',
                            );
                    }
                    return ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.only(bottom: 16),
                      itemCount: ideas.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final idea = ideas[index];
                        return BacklogSwipeToDelete(
                          itemKey: ValueKey('idea-${idea.id}'),
                          deleting: _deleting.contains(idea.id),
                          onConfirmDelete: () => _delete(idea),
                          onDismissed: () => setState(() => _dismissed.add(idea.id)),
                          child: _IdeaTile(
                            idea: idea,
                            themeName: ideaThemeName(themes, idea.themeId),
                            onTap: () => showIdeaActionsSheet(context, idea),
                          ),
                        );
                      },
                    );
                  },
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (_, __) => CenteredMessage(
                    icon: Icons.error_outline,
                    iconColor: Colors.red,
                    message: 'アイデアの取得に失敗しました',
                    action: ElevatedButton(
                      onPressed: () => ref.invalidate(ideaListProvider),
                      child: const Text('再試行'),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// 適用中の条件をチップで並べる。× で個別に解除できる（タスク一覧と同じ流儀）。
  /// テーマは常に選ばれているので × は付けない（変更はシートから）。
  Widget _buildActiveFilterChips(IdeaFilter filter, List<TaskTheme>? themes) {
    final themeId = filter.themeId;
    final priority = filter.priority;
    final status = filter.status;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            if (themeId != null)
              InputChip(
                label: Text(themeId == ideaNoThemeId
                    ? 'テーマ：指定なし'
                    : 'テーマ：${ideaThemeName(themes, themeId) ?? '指定中'}'),
                onPressed: () => showIdeaFilterSheet(context),
                tooltip: 'テーマを変更',
              ),
            if (status != null)
              InputChip(
                label: Text('状態：${ideaStatusLabels[status] ?? status}'),
                onDeleted: () => _setFilter(filter.copyWith(clearStatus: true)),
                deleteButtonTooltipMessage: '状態の絞り込みを解除',
              ),
            if (priority != null)
              InputChip(
                label: Text('優先度：${ideaPriorityLabels[priority] ?? priority}'),
                onDeleted: () => _setFilter(filter.copyWith(clearPriority: true)),
                deleteButtonTooltipMessage: '優先度の絞り込みを解除',
              ),
            if (filter.search.isNotEmpty)
              InputChip(
                label: Text('キーワード：${filter.search}'),
                onDeleted: () => _setFilter(filter.copyWith(search: '')),
                deleteButtonTooltipMessage: 'キーワードの絞り込みを解除',
              ),
          ],
        ),
      ),
    );
  }
}

/// アイデア行（タイトル＋優先度・テーマ・使用済みのチップ＋作成日）。タップで操作シート、削除は行のスワイプで行う
class _IdeaTile extends StatelessWidget {
  final Idea idea;

  /// テーマ名。テーマ一覧が取れない・該当が無いときは null で、何も出さない
  final String? themeName;

  /// 行タップ（操作シートを開く）
  final VoidCallback onTap;

  const _IdeaTile({
    required this.idea,
    required this.themeName,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final priorityLabel = ideaPriorityLabels[idea.priority];
    final date = formatBacklogDate(idea.createdAt);
    return ListTile(
      title: Text(
        idea.title.isNotEmpty ? idea.title : '（無題）',
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 4),
        // NOTE: Row から Wrap に変更。テーマ名・使用済みが加わり、狭い幅で横にはみ出すため
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (priorityLabel != null)
              BacklogChip(
                label: '優先度 $priorityLabel',
                color: backlogPriorityColor(idea.priority),
              ),
            if (themeName case final name?) BacklogChip(label: name),
            if (idea.usedInTaskId != null)
              const BacklogChip(label: '使用済み', color: Colors.green),
            if (date.isNotEmpty) Text(date),
          ],
        ),
      ),
      onTap: onTap,
    );
  }
}
