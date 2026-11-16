import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
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

class TaskListScreen extends ConsumerStatefulWidget {
  const TaskListScreen({super.key});

  @override
  ConsumerState<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends ConsumerState<TaskListScreen> {
  static const Duration _searchDebounceDuration = Duration(milliseconds: 300);

  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;
  bool _searchMode = false;

  /// 声で検索を開いたか。声で開いたときは検索欄に自動でフォーカスしない
  /// （フォーカスやキーボードが出ると常時聞き取りが止まり、続けて「2番目を開いて」と言えなくなる）
  bool _searchByVoice = false;

  /// 古い検索の結果で新しい結果を上書きしないための通し番号
  int _searchSeq = 0;

  /// 検索結果。null はまだ何も入力していない状態
  AsyncValue<List<Task>>? _searchResults;

  @override
  void initState() {
    super.initState();
    // 音声コマンドの「N番目を開く」などは、いま見えている一覧（検索中は検索結果）を対象にする
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
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  List<Task>? _visibleTasks() {
    if (_searchMode) return _searchResults?.valueOrNull ?? const [];
    return ref.read(taskListProvider(ref.read(taskFilterProvider))).valueOrNull;
  }

  /// 音声コマンドの「検索 ◯◯」：検索を開いて語句を入れ、すぐ検索する
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
    _searchNow(query);
  }

  void _openSearch() {
    setState(() {
      _searchMode = true;
      _searchByVoice = false;
    });
  }

  void _closeSearch() {
    _searchDebounce?.cancel();
    _searchController.clear();
    setState(() {
      _searchSeq++;
      _searchMode = false;
      _searchResults = null;
    });
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    // 入力が変わった時点で番号を進め、実行中の古い検索結果を捨てさせる
    final seq = ++_searchSeq;
    final query = value.trim();
    if (query.isEmpty) {
      setState(() => _searchResults = null);
      return;
    }
    // クリアボタンの表示を入力に追従させる
    setState(() {});
    _searchDebounce = Timer(_searchDebounceDuration, () => _runSearch(query, seq));
  }

  /// 新しい番号を取って即座に検索する（送信・再試行・詳細から戻ったとき）
  void _searchNow(String query) {
    _searchDebounce?.cancel();
    _runSearch(query, ++_searchSeq);
  }

  /// 詳細画面を開き、戻ったら現在のクエリで検索し直す（編集・削除を結果に反映するため）
  Future<void> _openTaskFromSearch(String taskId) async {
    await context.push('/tasks/$taskId');
    if (!mounted || !_searchMode) return;
    final query = _searchController.text.trim();
    if (query.isNotEmpty) _searchNow(query);
  }

  /// 検索中の音声「更新」「再試行」の処理。検索語が空のときは null（この画面では更新できない）
  Future<void> Function()? _voiceRefreshSearch() {
    if (_searchController.text.trim().isEmpty) return null;
    return () async {
      final query = _searchController.text.trim();
      if (query.isNotEmpty) _searchNow(query);
    };
  }

  Future<void> _runSearch(String query, int seq) async {
    if (!mounted || seq != _searchSeq) return;
    setState(() => _searchResults = const AsyncLoading<List<Task>>());
    try {
      final results = await ref.read(taskServiceProvider).searchTasks(query);
      if (!mounted || seq != _searchSeq) return;
      setState(() => _searchResults = AsyncData(results));
    } catch (e, stackTrace) {
      if (!mounted || seq != _searchSeq) return;
      setState(() => _searchResults = AsyncError<List<Task>>(e, stackTrace));
    }
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

    return PopScope(
      canPop: !_searchMode,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _searchMode) _closeSearch();
      },
      child: Scaffold(
        appBar: _searchMode ? _buildSearchAppBar() : _buildAppBar(isFiltered),
        // 検索モード中は AppBar の「検索を閉じる」ボタンを優先し、ドロワーは出さない
        // （端スワイプで開いてしまうのも防ぐ）
        drawer: _searchMode ? null : const AppDrawer(),
        body: VoiceScrollTarget(
          path: AppRoutes.tasks,
          // NOTE: 検索の本文には「引っ張って更新」が無いので、検索中の音声「更新」「再試行」は
          // ここで現在の検索語の再検索（再試行ボタンと同じ）に向ける。検索語が空なら更新するものは無い。
          onRefresh: _searchMode ? _voiceRefreshSearch() : null,
          child: _searchMode
              // 検索中は音声の「閉じる」「戻る」で検索を閉じる（タブの画面なので「戻る」の pop は効かない）
              ? VoiceDismissible(onDismiss: _closeSearch, child: _buildSearchBody())
              : _buildListBody(filter, isFiltered),
        ),
        // 検索中に作成しても検索結果は再取得されず新規タスクが反映されないため、
        // 検索モード中は作成用FABを出さない。
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

  PreferredSizeWidget _buildSearchAppBar() {
    return AppBar(
      leading: IconButton(
        icon: const Icon(Icons.arrow_back),
        tooltip: '検索を閉じる',
        onPressed: _closeSearch,
      ),
      title: TextField(
        controller: _searchController,
        autofocus: !_searchByVoice,
        textInputAction: TextInputAction.search,
        decoration: const InputDecoration(
          hintText: 'タスクを検索',
          border: InputBorder.none,
          filled: false,
        ),
        onChanged: _onSearchChanged,
        onSubmitted: (value) {
          final query = value.trim();
          if (query.isEmpty) return;
          _searchNow(query);
        },
      ),
      actions: [
        // 右にクリアが無いときは右端になるので、右端用の余白を取る
        VoiceModeIndicator(trailing: _searchController.text.isEmpty),
        if (_searchController.text.isNotEmpty)
          IconButton(
            icon: const Icon(Icons.clear),
            tooltip: 'クリア',
            onPressed: () {
              _searchController.clear();
              _onSearchChanged('');
            },
          ),
      ],
    );
  }

  Widget _buildSearchBody() {
    final results = _searchResults;
    if (results == null) {
      return const CenteredMessage(
        icon: Icons.search,
        message: 'キーワードを入力してください',
      );
    }
    return results.when(
      data: (tasks) {
        if (tasks.isEmpty) {
          return const CenteredMessage(
            icon: Icons.search_off,
            message: '見つかりませんでした',
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.all(8),
          itemCount: tasks.length,
          itemBuilder: (context, index) {
            final task = tasks[index];
            return TaskCard(
              task: task,
              onTap: () => _openTaskFromSearch(task.id),
            );
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => CenteredMessage(
        icon: Icons.error_outline,
        iconColor: Colors.red,
        message: '検索に失敗しました',
        action: ElevatedButton(
          onPressed: () {
            final query = _searchController.text.trim();
            if (query.isNotEmpty) _searchNow(query);
          },
          child: const Text('再試行'),
        ),
      ),
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
              data: (tasks) {
                if (tasks.isEmpty) {
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
