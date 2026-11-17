import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/filter_selection_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../services/filter_selection.dart';
import '../../providers/voice_provider.dart';
import '../../services/voice_command_flow.dart';
import '../../utils/constants.dart';
import '../../widgets/app_drawer.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/task_card.dart';
import '../../widgets/voice_dismissible.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../widgets/voice_mode_indicator.dart';
import 'task_filter_sheet.dart';
import 'task_search_app_bar.dart';

class TaskListScreen extends ConsumerStatefulWidget {
  const TaskListScreen({super.key});

  @override
  ConsumerState<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends ConsumerState<TaskListScreen> {
  // NOTE: nav72 で nav71 の常時表示の検索欄とサーバ検索（デバウンス・世代管理・結果の保持）をやめ、
  // 実行画面と同じ検索モード（AppBar の差し替え＋表示中の一覧をその場で絞る）に戻した。
  final TextEditingController _searchController = TextEditingController();
  bool _searchMode = false;

  /// 声で検索を開いたか。声で開いたときは検索欄に自動でフォーカスしない
  /// （フォーカスやキーボードが出ると常時聞き取りが止まり、続けて「2番目を開いて」と言えなくなる）
  bool _searchByVoice = false;

  @override
  void initState() {
    super.initState();
    // 音声コマンドの「N番目を開く」などは、いま見えている一覧（検索中は絞った後）を対象にする
    VoiceTaskListHook.visibleTasks = _visibleTasks;
    // テーマ一覧が届いたら一度だけ、記憶 → ☆ → 先頭 で解決したテーマを絞り込みに入れる。
    // NOTE: build 中にプロバイダーを書き換えられないので microtask へ逃がす
    ref.listenManual<AsyncValue<TaskSelection?>>(
      taskInitialSelectionProvider,
      (_, next) => Future.microtask(() {
        if (mounted) applyInitialTaskSelection(ref.read, next);
      }),
      fireImmediately: true,
    );
    // 別の画面から「検索 ◯◯」で来たときは、届いている依頼をここで受け取る
    WidgetsBinding.instance.addPostFrameCallback((_) => _takeVoiceSearch());
  }

  @override
  void dispose() {
    if (VoiceTaskListHook.visibleTasks == _visibleTasks) VoiceTaskListHook.visibleTasks = null;
    _searchController.dispose();
    super.dispose();
  }

  /// 一覧の絞りに使う語句。検索モード外では空（一覧はそのまま）
  String get _query => _searchMode ? _searchController.text : '';

  List<Task>? _visibleTasks() {
    final tasks = ref.read(taskListProvider(ref.read(taskFilterProvider))).valueOrNull;
    return tasks == null ? null : applyTaskSearch(tasks, _query);
  }

  /// 音声コマンドの「検索 ◯◯」：検索モードを開いて語句を入れる（フォーカスはしない）
  void _takeVoiceSearch() {
    if (!mounted) return;
    final query = ref.read(voiceTaskSearchRequestProvider);
    if (query == null) return;
    ref.read(voiceTaskSearchRequestProvider.notifier).state = null;
    _searchController.value = TextEditingValue(
      text: query,
      selection: TextSelection.collapsed(offset: query.length),
    );
    setState(() {
      _searchMode = true;
      _searchByVoice = true;
    });
  }

  void _openSearch() {
    setState(() {
      _searchMode = true;
      _searchByVoice = false;
    });
  }

  /// 検索モードを閉じる。閉じたら語句は消す（実行画面と同じ）
  void _closeSearch() {
    _searchController.clear();
    setState(() => _searchMode = false);
  }

  void _setFilter(TaskFilter filter) {
    ref.read(taskFilterProvider.notifier).state = filter;
  }

  /// テーマ以外（ステータス・優先度・プロジェクト）で絞り込んでいるか
  static bool _hasExtraFilter(TaskFilter filter) =>
      filter.copyWith(clearThemeId: true) != const TaskFilter();

  /// テーマ以外の条件を外す（テーマは解除できない）
  void _clearExtraFilters(TaskFilter filter) => _setFilter(TaskFilter(themeId: filter.themeId));

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(taskFilterProvider);
    // NOTE: テーマは常にどれかが選ばれている（「すべて」を廃止）ので、Badge・解除ボタンの対象はテーマ以外の条件だけ
    final isFiltered = _hasExtraFilter(filter);
    ref.listen<String?>(voiceTaskSearchRequestProvider, (_, next) {
      if (next != null) _takeVoiceSearch();
    });

    final list = _buildListBody(filter, isFiltered);
    return PopScope(
      canPop: !_searchMode,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _searchMode) _closeSearch();
      },
      child: Scaffold(
        appBar: _searchMode
            ? buildTaskSearchAppBar(
                controller: _searchController,
                autofocus: !_searchByVoice,
                onClose: _closeSearch,
                // クリアボタンの表示と一覧の絞りを入力に追従させる
                onChanged: (_) => setState(() {}),
              )
            : _buildAppBar(isFiltered),
        // 検索モード中は「検索を閉じる」矢印を優先し、ドロワーは出さない（端スワイプで開くのも防ぐ）
        drawer: _searchMode ? null : const AppDrawer(),
        body: VoiceScrollTarget(
          path: AppRoutes.tasks,
          // 検索中は音声の「閉じる」「戻る」で検索を閉じる（タブの画面なので「戻る」の pop は効かない）。
          // 音声の「更新」は検索中も下の「引っ張って更新」（一覧の再取得。絞りは自動で掛かり直す）
          child: _searchMode ? VoiceDismissible(onDismiss: _closeSearch, child: list) : list,
        ),
        // 検索モード中は作成FABを出さない（nav71 以前の扱い）
        // NOTE: 音声操作は設定の音声操作モード（常時聞き取り）から。聞き取り表示はタイトルバーのアイコンの左隣
        floatingActionButton: _searchMode
            ? null
            : FloatingActionButton(
                heroTag: 'add_task',
                onPressed: () => context.push(AppRoutes.taskNew),
                child: const Icon(Icons.add),
              ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(bool isFiltered) {
    return AppBar(
      title: const Text('タスク'),
      actions: [
        const VoiceModeIndicator(trailing: false),
        IconButton(
          key: const ValueKey('task-search-open'),
          icon: const Icon(Icons.search),
          tooltip: '検索',
          onPressed: _openSearch,
        ),
        IconButton(
          icon: Badge(
            isLabelVisible: isFiltered,
            child: const Icon(Icons.filter_list),
          ),
          tooltip: 'フィルター',
          onPressed: () => showTaskFilterSheet(context, ref),
        ),
      ],
    );
  }

  Widget _buildListBody(TaskFilter filter, bool isFiltered) {
    // 初期選択（テーマ）が決まるまでは全件を取りに行かない（全件→テーマの順に表示が切り替わるのを防ぐ）
    if (ref.watch(taskSelectionPendingProvider) && filter.themeId == null) {
      return const Center(child: CircularProgressIndicator());
    }
    final tasksAsync = ref.watch(taskListProvider(filter));
    return Column(
      children: [
        if (isFiltered || filter.themeId != null) _buildActiveFilterChips(filter),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(taskListProvider);
              // テーマ一覧の取得に失敗していたら取り直す（成功すれば初期選択がここで一度だけ入る）
              if (ref.read(themeListProvider).hasError) ref.invalidate(themeListProvider);
            },
            child: tasksAsync.when(
              data: (all) {
                // NOTE: キーワード入力中は絞り込み前から0件でも「キーワードに一致しない」を出す（通常の空表示だと検索が効いていないように見える）
                if (all.isEmpty && _query.trim().isEmpty) {
                  return isFiltered
                      ? CenteredMessage(
                          icon: Icons.filter_alt_off,
                          message: '条件に合うタスクはありません',
                          action: OutlinedButton.icon(
                            onPressed: () => _clearExtraFilters(filter),
                            icon: const Icon(Icons.filter_alt_off),
                            label: const Text('フィルターを解除'),
                          ),
                        )
                      : CenteredMessage(
                          icon: Icons.task_alt,
                          message: 'タスクはありません',
                          action: FilledButton.icon(
                            onPressed: () => context.push(AppRoutes.taskNew),
                            icon: const Icon(Icons.add),
                            label: const Text('タスクを作成'),
                          ),
                        );
                }
                // 検索モード中は表示中の一覧をその場で絞る。合うものが無ければ一覧の場所に空表示（別画面にしない）
                final tasks = applyTaskSearch(all, _query);
                if (tasks.isEmpty) {
                  return const CenteredMessage(
                    key: ValueKey('task-search-no-match'),
                    icon: Icons.search_off,
                    message: 'キーワードに一致するタスクはありません',
                  );
                }
                return ListView.builder(
                  padding: const EdgeInsets.all(8),
                  itemCount: tasks.length,
                  itemBuilder: (context, index) {
                    final task = tasks[index];
                    return TaskCard(
                      task: task,
                      onTap: () => context.push('/tasks/${task.id}'),
                    );
                  },
                );
              },
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => CenteredMessage(
                icon: Icons.error_outline,
                iconColor: Colors.red,
                message: 'タスクの取得に失敗しました',
                action: ElevatedButton(
                  onPressed: () => ref.invalidate(taskListProvider),
                  child: const Text('再試行'),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// 適用中のフィルターをチップで並べる。ステータス・優先度は × で個別に解除できる。
  /// テーマは常にどれかが選ばれているので × は付けない（変更はシートから）。
  Widget _buildActiveFilterChips(TaskFilter filter) {
    final status = filter.status;
    final priority = filter.priority;
    final themeId = filter.themeId;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            if (status != null)
              InputChip(
                label: Text('ステータス：${AppConstants.statusLabels[status] ?? status}'),
                onDeleted: () => _setFilter(filter.copyWith(clearStatus: true)),
                deleteButtonTooltipMessage: 'ステータスの絞り込みを解除',
              ),
            if (priority != null)
              InputChip(
                label: Text('優先度：${AppConstants.priorityLabels[priority] ?? priority}'),
                onDeleted: () => _setFilter(filter.copyWith(clearPriority: true)),
                deleteButtonTooltipMessage: '優先度の絞り込みを解除',
              ),
            if (themeId != null)
              InputChip(
                label: Text(_themeFilterLabel(filter)),
                onPressed: () => showTaskFilterSheet(context, ref),
                tooltip: 'テーマを変更',
              ),
          ],
        ),
      ),
    );
  }

  /// 適用中テーマのラベル。「テーマ：カテゴリ名 › テーマ名」→「テーマ：テーマ名」→「テーマ：指定中」の順に解決する。
  String _themeFilterLabel(TaskFilter filter) {
    final themeId = filter.themeId;
    final themes = ref.watch(themeListProvider).valueOrNull;
    if (themes != null) {
      for (final group in groupThemesByCategory(themes)) {
        for (final theme in group.themes) {
          if (theme.id != themeId) continue;
          final categoryName = group.category?.name;
          return categoryName != null && categoryName.isNotEmpty
              ? 'テーマ：$categoryName › ${theme.name}'
              : 'テーマ：${theme.name}';
        }
      }
    }
    // テーマ一覧が未取得・見つからない場合は、絞り込み結果のタスクが持つテーマ名を使う
    final tasks = ref.watch(taskListProvider(filter)).valueOrNull;
    if (tasks != null) {
      for (final task in tasks) {
        final theme = task.theme;
        if (theme != null && theme.id == themeId) return 'テーマ：${theme.name}';
      }
    }
    return 'テーマ：指定中';
  }
}
