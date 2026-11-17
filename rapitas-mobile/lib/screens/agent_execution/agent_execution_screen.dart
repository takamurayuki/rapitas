import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../widgets/execution_log_viewer.dart';
import '../../widgets/app_drawer.dart';
import '../../widgets/voice_dismissible.dart';
import 'auto_run_section.dart';
import 'exec_app_bars.dart';
import 'exec_filter.dart';
import 'exec_filter_bar.dart';
import 'exec_filter_sheet.dart';
import 'execution_section_states.dart';
import 'section_title.dart';

/// 上部に開発テーマの自動実行（AutoRunSection）、続いて実行中のタスクと、中断されて再開できる実行。
/// どちらもタスク中心の実在API（/tasks/executing, /agents/resumable-executions）から取る。
///
/// 絞り込みの形はタスク画面と同じ：AppBar の検索モード、フィルターシート、本文上部の適用中チップ列。
class AgentExecutionScreen extends ConsumerStatefulWidget {
  const AgentExecutionScreen({super.key});

  @override
  ConsumerState<AgentExecutionScreen> createState() => _AgentExecutionScreenState();
}

class _AgentExecutionScreenState extends ConsumerState<AgentExecutionScreen> {
  // 保持済みの検索語があれば検索モードで開き、入力欄に戻す（検索語が見えないまま効いている状態を作らない）
  late final TextEditingController _searchController =
      TextEditingController(text: ref.read(execFilterProvider).query);
  late bool _searchMode = _searchController.text.isNotEmpty;

  // 検索モードの出入りで VoiceDismissible を挟んでも、一覧（自動実行カードの状態など）を作り直さないため
  final _listKey = GlobalKey();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _setQuery(String query) {
    final notifier = ref.read(execFilterProvider.notifier);
    notifier.state = notifier.state.copyWith(query: query);
  }

  void _openSearch() => setState(() => _searchMode = true);

  /// 検索モードを閉じる。閉じたら検索語は消す（タスク画面と同じ）
  void _closeSearch() {
    _searchController.clear();
    _setQuery('');
    setState(() => _searchMode = false);
  }

  void _onSearchChanged(String text) {
    _setQuery(text);
    setState(() {}); // クリアボタンの表示を入力に追従させる
  }

  @override
  Widget build(BuildContext context) {
    // クリア操作（空表示のボタンなど）で条件が外から戻されたら入力欄も合わせる
    ref.listen<ExecFilter>(execFilterProvider, (_, next) {
      if (_searchController.text != next.query) setState(() => _searchController.text = next.query);
    });
    final executingAsync = ref.watch(executingTasksProvider);
    final resumableAsync = ref.watch(resumableExecutionsProvider);
    // NOTE: 一覧は絞り込み・並び替え後の表示一覧。音声の「2番目を停止」も同じ関数で数える（exec_filter.dart）
    final filter = ref.watch(execFilterProvider);
    final lookups = ref.watch(execLookupsProvider);
    final titles = lookups.titles;
    final allExecuting = executingAsync.valueOrNull;
    final allResumable = resumableAsync.valueOrNull;
    final executing = allExecuting == null ? null : applyExecutingFilter(allExecuting, filter, lookups);
    final resumable = allResumable == null ? null : applyResumableFilter(allResumable, filter, lookups);

    final list = RefreshIndicator(
      key: _listKey,
      onRefresh: () async {
        ref.invalidate(taskListProvider);
        final container = ProviderScope.containerOf(context, listen: false);
        _invalidateExecutions(container);
        AutoRunSection.invalidate(container);
      },
      // NOTE: 以前は両方空のとき一覧の下に大きなアイコンと文だけを出していたが、自動実行セクションの
      // 下に埋もれて見えにくかった。常に同じ並びにし、空は各見出しの直下に出す。
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(8),
        children: [
          // NOTE: 常時表示の絞り込みバー（ExecFilterBar）は廃止。適用中の条件だけをチップで出す
          const ExecActiveFilterChips(),
          const AutoRunSection(),
          const SectionTitle('実行中'),
          ..._buildSection<ExecutingTask>(
            state: executingAsync,
            items: executing,
            total: allExecuting?.length ?? 0,
            filtering: filter.filtersExecuting,
            noMatchKey: const ValueKey('executing-no-match'),
            empty: const ExecutingEmptyState(),
            errorText: '実行中のタスクを取得できませんでした',
            onRetry: () => ref.invalidate(executingTasksProvider),
            itemBuilder: (task) => _buildExecutingTile(context, ref, task, titles),
          ),
          const SizedBox(height: 16),
          const SectionTitle('再開可能'),
          ..._buildSection<ResumableExecution>(
            state: resumableAsync,
            items: resumable,
            total: allResumable?.where((e) => e.canResume).length ?? 0,
            filtering: filter.filtersOthers,
            noMatchKey: const ValueKey('resumable-no-match'),
            empty: const Card(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Center(child: Text('再開できる実行はありません')),
              ),
            ),
            errorText: '再開可能な実行を取得できませんでした',
            onRetry: () => ref.invalidate(resumableExecutionsProvider),
            itemBuilder: (execution) => _buildResumableTile(context, ref, execution, titles),
          ),
        ],
      ),
    );

    return PopScope(
      canPop: !_searchMode,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _searchMode) _closeSearch();
      },
      child: Scaffold(
        // 検索モード中は「検索を閉じる」矢印を優先し、ドロワーは出さない（タスク画面と同じ）
        drawer: _searchMode ? null : const AppDrawer(),
        appBar: _searchMode
            ? buildExecSearchAppBar(
                controller: _searchController,
                onClose: _closeSearch,
                onChanged: _onSearchChanged,
              )
            : buildExecAppBar(
                filterActive: execSheetFilterActive(filter),
                onSearch: _openSearch,
                onFilter: () => showExecFilterSheet(context, ref),
              ),
        // NOTE: 単一タスク実行の FAB（タスク選択→確認→実行）は削除した。タスクごとの実行は
        // タスク詳細画面と音声コマンドの別経路で行う。
        body: VoiceScrollTarget(
          path: '/executions',
          // 検索中は音声の「閉じる」「戻る」で検索を閉じる（タスク画面と同じ）
          child: _searchMode ? VoiceDismissible(onDismiss: _closeSearch, child: list) : list,
        ),
      ),
    );
  }

  List<Widget> _buildSection<T>({
    required AsyncValue<Object?> state,
    required List<T>? items,
    required int total,
    required bool filtering,
    required Key noMatchKey,
    required Widget empty,
    required String errorText,
    required VoidCallback onRetry,
    required Widget Function(T item) itemBuilder,
  }) {
    if (state.hasError) {
      return [SectionError(message: errorText, onRetry: onRetry)];
    }
    if (items == null) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    // 絞り込み中の0件は「条件に合うものなし」。本当に空の表示は絞り込みが無いときだけ
    return [
      if (filtering) FilterCountLine(total: total, shown: items.length),
      if (items.isEmpty) filtering ? ExecNoMatch(key: noMatchKey) : empty,
      ...items.map(itemBuilder),
    ];
  }

  Widget _buildExecutingTile(
    BuildContext context,
    WidgetRef ref,
    ExecutingTask task,
    Map<String, String> titles,
  ) {
    final title = taskTitleOrFallback(titles, task.taskId);
    final elapsed = _elapsedText(task);
    return Card(
      child: ListTile(
        leading: task.isWaitingForInput
            ? const Icon(Icons.help_outline, color: Colors.orange)
            : const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Row(
          children: [
            StatusBadge.execution(status: task.executionStatus),
            if (task.isWaitingForInput) ...[
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  'エージェントが回答を待っています',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Colors.orange),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ] else if (elapsed != null) ...[
              const SizedBox(width: 8),
              Text(elapsed, style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        ),
        trailing: IconButton(
          icon: const Icon(Icons.stop, color: Colors.red),
          tooltip: '停止',
          onPressed: () => _stopExecution(context, ref, task.taskId, title),
        ),
        onTap: () => _showLogs(
          context,
          title: title,
          taskId: task.taskId,
          executionId: task.executionId,
        ),
      ),
    );
  }

  Widget _buildResumableTile(
    BuildContext context,
    WidgetRef ref,
    ResumableExecution execution,
    Map<String, String> titles,
  ) {
    final title = execution.taskTitle ??
        taskTitleOrFallback(titles, execution.taskId);
    final error = execution.errorMessage;
    final taskId = execution.taskId;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.pause_circle, color: Colors.amber),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: error != null && error.isNotEmpty
            ? Text(
                error,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Colors.red),
              )
            : const Text('中断'),
        trailing: TextButton.icon(
          icon: const Icon(Icons.play_arrow),
          label: const Text('再開'),
          onPressed: () =>
              _resumeExecution(context, execution.id, taskId: taskId),
        ),
        onTap: taskId == null
            ? null
            : () => _showLogs(
                  context,
                  title: title,
                  taskId: taskId,
                  executionId: execution.id,
                ),
      ),
    );
  }

  /// 経過時間 = それまでのフェーズの累計（activeTimeMs）+ 現在の実行の経過
  String? _elapsedText(ExecutingTask task) {
    final startedAt = task.startedAt;
    if (startedAt == null && task.activeTimeMs == 0) return null;
    var ms = task.activeTimeMs;
    if (startedAt != null) {
      final live = DateTime.now().difference(startedAt).inMilliseconds;
      if (live > 0) ms += live;
    }
    final minutes = ms ~/ 60000;
    if (minutes < 1) return '1分未満';
    if (minutes < 60) return '$minutes分経過';
    return '${minutes ~/ 60}時間${minutes % 60}分経過';
  }

  /// 実行の状態が変わる操作の後に読み直すもの。
  ///
  /// API の await 中に画面が破棄されると WidgetRef は使えなくなるが、
  /// サーバー側の状態は変わっているのでキャッシュの読み直し自体は必要。
  /// そのため await の前に控えた ProviderContainer から invalidate する。
  static void _invalidateExecutions(ProviderContainer container) {
    container.invalidate(executingTasksProvider);
    container.invalidate(resumableExecutionsProvider);
    container.invalidate(taskExecutionLogsProvider);
  }

  Future<void> _stopExecution(
    BuildContext context,
    WidgetRef ref,
    String taskId,
    String title,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('実行を停止'),
        content: Text('「$title」の実行を停止しますか？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('いいえ')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('停止')),
        ],
      ),
    );

    // ダイアログ表示中に画面が破棄されていたら ref は使えない
    if (confirmed != true || !context.mounted) return;
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(agentServiceProvider).stopTaskExecution(taskId);
      _invalidateExecutions(container);
      // 停止でタスクのステータスも戻るので一覧も読み直す
      container.invalidate(taskListProvider);
      container.invalidate(taskDetailProvider(taskId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('実行を停止しました')),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('停止に失敗しました: $e')),
        );
      }
    }
  }

  Future<void> _resumeExecution(
    BuildContext context,
    String executionId, {
    required String? taskId,
  }) async {
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(agentServiceProvider).resumeExecution(executionId);
      _invalidateExecutions(container);
      container.invalidate(taskListProvider);
      // タスクが外れた実行（taskId なし）は詳細キャッシュが無いのでスキップ
      if (taskId != null) container.invalidate(taskDetailProvider(taskId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('実行を再開しました')),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('再開に失敗しました: $e')),
        );
      }
    }
  }

  void _showLogs(
    BuildContext context, {
    required String title,
    required String taskId,
    required String executionId,
  }) {
    final key = (taskId: taskId, executionId: executionId);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.7,
          minChildSize: 0.3,
          maxChildSize: 0.95,
          expand: false,
          builder: (context, scrollController) {
            return Consumer(
              builder: (context, ref, _) {
                final logsAsync = ref.watch(taskExecutionLogsProvider(key));
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '実行ログ：$title',
                              style: Theme.of(context).textTheme.titleMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.refresh),
                            tooltip: '再読み込み',
                            onPressed: () =>
                                ref.invalidate(taskExecutionLogsProvider(key)),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => Navigator.pop(context),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: logsAsync.when(
                        data: (logs) => ExecutionLogViewer(
                          logs: logs,
                          scrollController: scrollController,
                        ),
                        loading: () =>
                            const Center(child: CircularProgressIndicator()),
                        error: (e, _) =>
                            Center(child: Text('ログの取得に失敗しました: $e')),
                      ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }
}
