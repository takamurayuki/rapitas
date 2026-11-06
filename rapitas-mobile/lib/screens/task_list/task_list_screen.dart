import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/voice_command_parser.dart';
import '../../widgets/task_card.dart';
import '../../widgets/voice_input_sheet.dart';

class TaskListScreen extends ConsumerWidget {
  const TaskListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(taskFilterProvider);
    final tasksAsync = ref.watch(taskListProvider(filter));
    return Scaffold(
      appBar: AppBar(
        title: const Text('タスク'),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list),
            onPressed: () => _showFilterSheet(context, ref),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(taskListProvider);
        },
        child: tasksAsync.when(
          data: (tasks) {
            if (tasks.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.task_alt, size: 64, color: Colors.grey),
                    SizedBox(height: 16),
                    Text('タスクはありません'),
                  ],
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
          error: (error, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('タスクの取得に失敗しました'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => ref.invalidate(taskListProvider),
                  child: const Text('再試行'),
                ),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: Column(
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
            onPressed: () => _showCreateTaskDialog(context, ref),
            child: const Icon(Icons.add),
          ),
        ],
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

  void _showCreateTaskDialog(BuildContext context, WidgetRef ref) {
    final titleController = TextEditingController();
    final descriptionController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: const Text('新しいタスク'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: titleController,
                decoration: const InputDecoration(
                  labelText: 'タイトル',
                  hintText: 'タスクのタイトルを入力',
                ),
                autofocus: true,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: descriptionController,
                decoration: const InputDecoration(
                  labelText: '説明（任意）',
                  hintText: 'タスクの説明を入力',
                ),
                maxLines: 3,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('キャンセル'),
            ),
            FilledButton(
              onPressed: () async {
                if (titleController.text.isNotEmpty) {
                  final service = ref.read(taskServiceProvider);
                  await service.createTask({
                    'title': titleController.text,
                    'description': descriptionController.text.isEmpty
                        ? null
                        : descriptionController.text,
                  });
                  ref.invalidate(taskListProvider);
                  if (context.mounted) Navigator.pop(context);
                }
              },
              child: const Text('作成'),
            ),
          ],
        );
      },
    );
  }
}
