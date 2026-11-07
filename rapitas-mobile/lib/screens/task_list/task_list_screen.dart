import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/task.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/voice_command_parser.dart';
import '../../utils/constants.dart';
import '../../widgets/task_card.dart';
import '../../widgets/voice_input_sheet.dart';

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

  /// 古い検索の結果で新しい結果を上書きしないための通し番号
  int _searchSeq = 0;

  /// 検索結果。null はまだ何も入力していない状態
  AsyncValue<List<Task>>? _searchResults;

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _openSearch() {
    setState(() => _searchMode = true);
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

  @override
  Widget build(BuildContext context) {
    final filter = ref.watch(taskFilterProvider);
    final isFiltered = filter != const TaskFilter();

    return PopScope(
      canPop: !_searchMode,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _searchMode) _closeSearch();
      },
      child: Scaffold(
        appBar: _searchMode ? _buildSearchAppBar() : _buildAppBar(isFiltered),
        body: _searchMode ? _buildSearchBody() : _buildListBody(filter, isFiltered),
        // 検索中に作成しても検索結果は再取得されず新規タスクが反映されないため、
        // 検索モード中は作成用FABを出さない。
        floatingActionButton: _searchMode
            ? null
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  FloatingActionButton.small(
                    heroTag: 'voice_task',
                    onPressed: () => _handleVoiceInput(context, ref),
                    child: const Icon(Icons.mic),
                  ),
                  const SizedBox(height: 8),
                  FloatingActionButton(
                    heroTag: 'add_task',
                    onPressed: () => context.push(AppRoutes.taskNew),
                    child: const Icon(Icons.add),
                  ),
                ],
              ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(bool isFiltered) {
    return AppBar(
      title: const Text('タスク'),
      actions: [
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
          onPressed: () => _showFilterSheet(context, ref),
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
        autofocus: true,
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
      return const _CenteredMessage(
        icon: Icons.search,
        message: 'キーワードを入力してください',
      );
    }
    return results.when(
      data: (tasks) {
        if (tasks.isEmpty) {
          return const _CenteredMessage(
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
      error: (error, _) => _CenteredMessage(
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
    final tasksAsync = ref.watch(taskListProvider(filter));
    return Column(
      children: [
        if (isFiltered) _buildActiveFilterChips(filter),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(taskListProvider);
            },
            child: tasksAsync.when(
              data: (tasks) {
                if (tasks.isEmpty) {
                  return isFiltered
                      ? _CenteredMessage(
                          icon: Icons.filter_alt_off,
                          message: '条件に合うタスクはありません',
                          action: OutlinedButton.icon(
                            onPressed: () => _setFilter(const TaskFilter()),
                            icon: const Icon(Icons.filter_alt_off),
                            label: const Text('フィルターを解除'),
                          ),
                        )
                      : _CenteredMessage(
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
              error: (error, _) => _CenteredMessage(
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

  /// 適用中のフィルターをチップで並べる。× で個別に解除できる。
  Widget _buildActiveFilterChips(TaskFilter filter) {
    final status = filter.status;
    final priority = filter.priority;
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
          ],
        ),
      ),
    );
  }

  void _showFilterSheet(BuildContext context, WidgetRef ref) {
    final filter = ref.read(taskFilterProvider);

    showModalBottomSheet(
      context: context,
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('フィルター', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              Text('ステータス', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilterChip(
                    label: const Text('すべて'),
                    selected: filter.status == null,
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(clearStatus: true);
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('未着手'),
                    selected: filter.status == 'todo',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(status: 'todo');
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('進行中'),
                    selected: filter.status == 'in-progress',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(status: 'in-progress');
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('完了'),
                    selected: filter.status == 'done',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(status: 'done');
                      Navigator.pop(context);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text('優先度', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  FilterChip(
                    label: const Text('すべて'),
                    selected: filter.priority == null,
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(clearPriority: true);
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('緊急'),
                    selected: filter.priority == 'urgent',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(priority: 'urgent');
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('高'),
                    selected: filter.priority == 'high',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(priority: 'high');
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('中'),
                    selected: filter.priority == 'medium',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(priority: 'medium');
                      Navigator.pop(context);
                    },
                  ),
                  FilterChip(
                    label: const Text('低'),
                    selected: filter.priority == 'low',
                    onSelected: (_) {
                      ref.read(taskFilterProvider.notifier).state =
                          filter.copyWith(priority: 'low');
                      Navigator.pop(context);
                    },
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
          ),
        );
      },
    );
  }

  void _handleVoiceInput(BuildContext context, WidgetRef ref) async {
    final command = await VoiceInputSheet.show(
      context,
      expectedType: VoiceCommandType.createTask,
      hint: 'タスクのタイトルを話してください',
    );

    if (command == null || !context.mounted) return;

    if (command.type == VoiceCommandType.createTask && command.title != null) {
      try {
        final service = ref.read(taskServiceProvider);
        await service.createTask({
          'title': command.title!,
          if (command.priority != null) 'priority': command.priority!,
        });
        ref.invalidate(taskListProvider);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('タスク「${command.title}」を作成しました')),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('タスクの作成に失敗しました: $e')),
          );
        }
      }
    }
  }
}

/// 一覧が空・エラーのときの中央表示。引っ張って更新できるようスクロール可能にしてある。
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
