import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';

/// ダブルタップでその場編集できるタスク詳細の項目。
enum TaskInlineField { title, description }

/// 項目をダブルタップで編集ダイアログにつなぐ。保存は PATCH /tasks/:id にその項目だけ送る。
class TaskInlineEditable extends ConsumerWidget {
  final String taskId;
  final TaskInlineField field;
  final String initialValue;
  final Widget child;

  const TaskInlineEditable({
    super.key,
    required this.taskId,
    required this.field,
    required this.initialValue,
    required this.child,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GestureDetector(
      key: ValueKey('task-inline-${field.name}'),
      behavior: HitTestBehavior.opaque,
      onDoubleTap: () => _edit(context),
      child: child,
    );
  }

  Future<void> _edit(BuildContext context) async {
    final next = await showDialog<String>(
      context: context,
      builder: (_) => TaskFieldEditDialog(field: field, initialValue: initialValue),
    );
    // NOTE: Only the title is trimmed; description whitespace is Markdown (indented code etc.).
    final current = field == TaskInlineField.title ? initialValue.trim() : initialValue;
    if (next == null || next == current || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    // 保存中に画面を離れても読み直せるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(taskServiceProvider).updateTask(taskId, {field.name: next});
      container.invalidate(taskDetailProvider(taskId));
      container.invalidate(taskListProvider);
    } catch (e) {
      messenger.showSnackBar(
        SnackBar(content: Text('${_label(field)}の保存に失敗しました: $e')),
      );
    }
  }
}

String _label(TaskInlineField field) =>
    field == TaskInlineField.title ? 'タイトル' : '説明';

/// タイトル（1行）／説明（複数行・Markdown 原文）の編集ダイアログ。
/// 保存でタイトルは前後の空白を除いた値、説明は入力原文のまま返し、キャンセルなら null。
/// 空タイトルは保存できない。
class TaskFieldEditDialog extends StatefulWidget {
  final TaskInlineField field;
  final String initialValue;

  const TaskFieldEditDialog({super.key, required this.field, required this.initialValue});

  @override
  State<TaskFieldEditDialog> createState() => _TaskFieldEditDialogState();
}

class _TaskFieldEditDialogState extends State<TaskFieldEditDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);

  bool get _isTitle => widget.field == TaskInlineField.title;
  bool get _canSave => !_isTitle || _controller.text.trim().isNotEmpty;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    if (!_canSave) return;
    // NOTE: Description is returned verbatim — trimming would break Markdown indentation.
    Navigator.pop(context, _isTitle ? _controller.text.trim() : _controller.text);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('${_label(widget.field)}を編集'),
      content: SizedBox(
        width: double.maxFinite,
        child: TextField(
          key: const ValueKey('task-inline-edit-field'),
          controller: _controller,
          autofocus: true,
          // バックエンドの PATCH /tasks/:id の上限（title 500 / description 20000）に合わせる
          maxLength: _isTitle ? 500 : 20000,
          maxLines: _isTitle ? 1 : 10,
          minLines: _isTitle ? 1 : 5,
          keyboardType: _isTitle ? TextInputType.text : TextInputType.multiline,
          textInputAction: _isTitle ? TextInputAction.done : TextInputAction.newline,
          onSubmitted: _isTitle ? (_) => _save() : null,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            hintText: _isTitle ? 'タイトル' : '説明（Markdown）',
            counterText: '',
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('キャンセル'),
        ),
        FilledButton(
          key: const ValueKey('task-inline-edit-save'),
          onPressed: _canSave ? _save : null,
          child: const Text('保存'),
        ),
      ],
    );
  }
}
