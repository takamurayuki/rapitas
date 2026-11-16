/// タスク詳細のサブタスク欄：見出し＋進捗バー、一覧（タップで完了・未完了の切り替え）、追加フォーム。
///
/// 追加の API 呼び出しはデスクトップの追加フォーム（rapitas-frontend の useSubtaskManagement.addSubtask）に合わせ、
/// `POST /tasks` に `parentId` を付けて送る。一覧の切り替え処理そのものは画面側が持つ。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../utils/constants.dart';
import '../../widgets/subtask_progress.dart';

/// サブタスク作成（`POST /tasks`）に送るボディを作る。
///
/// デスクトップと同じく status は 'todo' 固定、説明と工数は値があるときだけ送る。
/// バックエンドの作成スキーマに actualHours は無いので送らない（デスクトップは送るが捨てられる）。
///
/// @param parentId - 親タスクのID / 数値の文字列
/// @param title - タイトル / 前後の空白は落とす
/// @param description - 説明 / 空なら省略
/// @param priority - 優先度 / low, medium, high, urgent
/// @param estimatedHours - 工数（時間）の入力文字列 / 0 や数値でなければ省略
/// @returns リクエストボディ / null を含まない Map
/// @throws ArgumentError parentId が数値でないとき / 親を指定できないため
Map<String, dynamic> buildSubtaskCreateBody({
  required String parentId,
  required String title,
  String? description,
  String priority = 'medium',
  String? estimatedHours,
}) {
  final parent = int.tryParse(parentId);
  if (parent == null) {
    throw ArgumentError.value(parentId, 'parentId', '親タスクのIDが数値ではありません');
  }
  final trimmedDescription = description?.trim() ?? '';
  final hours = double.tryParse(estimatedHours?.trim() ?? '');
  return {
    'title': title.trim(),
    'parentId': parent,
    'status': 'todo',
    'priority': priority,
    if (trimmedDescription.isNotEmpty) 'description': trimmedDescription,
    if (hours != null && hours > 0) 'estimatedHours': hours,
  };
}

/// サブタスク欄。サブタスクが 0 件でも、最初の 1 件を作れるよう見出しと追加ボタンは出す。
class SubtaskSection extends StatefulWidget {
  final Task task;

  /// サブタスクをタップしたときの完了・未完了の切り替え（従来どおり画面側の処理）
  final void Function(Task subtask) onToggle;

  const SubtaskSection({super.key, required this.task, required this.onToggle});

  @override
  State<SubtaskSection> createState() => _SubtaskSectionState();
}

class _SubtaskSectionState extends State<SubtaskSection> {
  bool _isAdding = false;

  @override
  Widget build(BuildContext context) {
    final subtasks = widget.task.subtasks ?? const <Task>[];
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                subtasks.isEmpty ? 'サブタスク' : 'サブタスク (${subtasks.length})',
                style: textTheme.titleSmall,
              ),
            ),
            TextButton.icon(
              key: const ValueKey('subtask-add-toggle'),
              onPressed: () => setState(() => _isAdding = !_isAdding),
              icon: Icon(_isAdding ? Icons.close : Icons.playlist_add, size: 18),
              label: Text(_isAdding ? '閉じる' : 'サブタスクを追加'),
            ),
          ],
        ),
        if (subtasks.isNotEmpty) ...[
          const SizedBox(height: 4),
          SubtaskProgress(subtasks: subtasks),
        ],
        const SizedBox(height: 8),
        // デスクトップと同じく、追加フォームを開いている間はフォームだけを見せる
        if (_isAdding)
          SubtaskAddForm(
            parentId: widget.task.id,
            onCreated: () => setState(() => _isAdding = false),
          )
        else
          ...subtasks.map((subtask) => Card(
                child: ListTile(
                  leading: Icon(
                    subtask.status == 'done'
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    color: subtask.status == 'done' ? Colors.green : Colors.grey,
                  ),
                  title: Text(subtask.title),
                  subtitle: Text(
                    AppConstants.statusLabels[subtask.status] ?? subtask.status,
                  ),
                  onTap: () => widget.onToggle(subtask),
                ),
              )),
      ],
    );
  }
}

/// サブタスクの追加フォーム。項目はデスクトップの追加フォームに合わせる（タイトル・説明・優先度・工数）。
class SubtaskAddForm extends ConsumerStatefulWidget {
  final String parentId;

  /// 作成に成功したあとに呼ぶ（フォームを閉じる）
  final VoidCallback onCreated;

  const SubtaskAddForm({super.key, required this.parentId, required this.onCreated});

  @override
  ConsumerState<SubtaskAddForm> createState() => _SubtaskAddFormState();
}

class _SubtaskAddFormState extends ConsumerState<SubtaskAddForm> {
  static const _priorities = ['low', 'medium', 'high', 'urgent'];

  final _titleController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _hoursController = TextEditingController();
  String _priority = 'medium';
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    // 保存ボタンの有効・無効をタイトルの入力に追従させる
    _titleController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _hoursController.dispose();
    super.dispose();
  }

  bool get _canSubmit => !_submitting && _titleController.text.trim().isNotEmpty;

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() => _submitting = true);
    final messenger = ScaffoldMessenger.of(context);
    // 作成中に画面を離れても読み直せるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(taskServiceProvider).createTask(buildSubtaskCreateBody(
            parentId: widget.parentId,
            title: _titleController.text,
            description: _descriptionController.text,
            priority: _priority,
            estimatedHours: _hoursController.text,
          ));
      container.invalidate(taskDetailProvider(widget.parentId));
      container.invalidate(taskListProvider);
      if (!mounted) return;
      widget.onCreated();
    } catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      messenger.showSnackBar(
        SnackBar(content: Text('サブタスクの作成に失敗しました: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const ValueKey('subtask-title-field'),
              controller: _titleController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'タイトル',
                hintText: 'サブタスクを追加...',
              ),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('subtask-description-field'),
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: 'サブタスクの説明（任意）',
                alignLabelWithHint: true,
              ),
              minLines: 2,
              maxLines: 5,
            ),
            const SizedBox(height: 16),
            Text('優先度', style: textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final priority in _priorities)
                  ChoiceChip(
                    label: Text(AppConstants.priorityLabels[priority]!),
                    selected: _priority == priority,
                    onSelected: (_) => setState(() => _priority = priority),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('subtask-hours-field'),
              controller: _hoursController,
              decoration: const InputDecoration(
                labelText: '工数（時間・任意）',
                hintText: '例: 1.5',
                prefixIcon: Icon(Icons.access_time),
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: const ValueKey('subtask-save'),
                onPressed: _canSubmit ? _submit : null,
                icon: _submitting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save, size: 18),
                label: const Text('保存'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
