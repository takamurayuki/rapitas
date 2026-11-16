import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/task.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../providers/theme_data_provider.dart';
import '../../utils/color_utils.dart';
import '../../utils/constants.dart';
import '../../utils/date_formatter.dart';
import '../../services/voice_opened_screens.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';

/// タスク作成・更新 API に送るボディを作る。
///
/// バックエンド（Elysia の t.Optional）は null を受け付けないため、値の無い項目はキーごと省く。
/// 編集時に説明を空にした場合だけは、消したことを伝えるため空文字を送る。
///
/// @param title - タイトル / 前後の空白は落とす
/// @param description - 説明 / 空なら作成時は省略、編集時は空文字
/// @param priority - 優先度 / low, medium, high, urgent
/// @param dueDate - 期限 / 日付のみの ISO8601（yyyy-MM-dd）で送る
/// @param themeId - テーマID / int にして送る。int に変換できなければキーごと省く
/// @param isEdit - 編集（PATCH）用のボディか
/// @returns リクエストボディ / null を含まない Map
Map<String, dynamic> buildTaskFormBody({
  required String title,
  String? description,
  required String priority,
  DateTime? dueDate,
  String? themeId,
  bool isEdit = false,
}) {
  final trimmedDescription = description?.trim() ?? '';
  final parsedThemeId = int.tryParse(themeId?.trim() ?? '');
  return {
    'title': title.trim(),
    if (trimmedDescription.isNotEmpty)
      'description': trimmedDescription
    else if (isEdit)
      'description': '',
    'priority': priority,
    if (dueDate != null) 'dueDate': _formatDateOnly(dueDate),
    if (parsedThemeId != null) 'themeId': parsedThemeId,
  };
}

String _formatDateOnly(DateTime date) {
  final year = date.year.toString().padLeft(4, '0');
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

/// タスクの作成・編集フォーム。taskId も task も無ければ作成、どちらかがあれば編集。
class TaskFormScreen extends ConsumerWidget {
  /// 編集対象のタスクID（`/tasks/:id/edit`）
  final String? taskId;

  /// 編集対象のタスク。渡されなければ taskId で読み込む
  final Task? task;

  const TaskFormScreen({super.key, this.taskId, this.task});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initial = task;
    final id = taskId;
    if (initial != null || id == null) {
      return _TaskForm(task: initial);
    }

    final taskAsync = ref.watch(taskDetailProvider(id));
    return taskAsync.when(
      data: (loaded) => _TaskForm(task: loaded),
      loading: () => Scaffold(
        appBar: AppBar(title: const Text('タスクを編集'), actions: const [VoiceModeIndicator()]),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Scaffold(
        appBar: AppBar(title: const Text('タスクを編集'), actions: const [VoiceModeIndicator()]),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 64, color: Colors.red),
              const SizedBox(height: 16),
              const Text('タスクの取得に失敗しました'),
              const SizedBox(height: 8),
              ElevatedButton(
                onPressed: () => ref.invalidate(taskDetailProvider(id)),
                child: const Text('再試行'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TaskForm extends ConsumerStatefulWidget {
  final Task? task;

  const _TaskForm({this.task});

  @override
  ConsumerState<_TaskForm> createState() => _TaskFormState();
}

class _TaskFormState extends ConsumerState<_TaskForm> {
  static const List<String> _priorities = ['low', 'medium', 'high', 'urgent'];

  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late String _priority;
  DateTime? _dueDate;
  String? _themeId;
  bool _saving = false;

  bool get _isEdit => widget.task != null;

  /// 声で開いた新規作成か（タイトル欄に自動でフォーカスしない）
  bool _openedByVoice = false;

  @override
  void initState() {
    super.initState();
    // 声で開いたときは入力欄にフォーカスしない（常時聞き取りを止めないため。VoiceOpenedScreens）
    _openedByVoice = !_isEdit && VoiceOpenedScreens.consume(AppRoutes.taskNew);
    final task = widget.task;
    _titleController = TextEditingController(text: task?.title ?? '');
    _descriptionController = TextEditingController(text: task?.description ?? '');
    _priority = _priorities.contains(task?.priority) ? task!.priority : 'medium';
    final due = task?.dueDate;
    _dueDate = due != null ? DateTime(due.year, due.month, due.day) : null;
    _themeId = task?.themeId ?? task?.theme?.id;
    _titleController.addListener(_onTitleChanged);
  }

  @override
  void dispose() {
    _titleController.removeListener(_onTitleChanged);
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  void _onTitleChanged() => setState(() {});

  bool get _canSave => !_saving && _titleController.text.trim().isNotEmpty;

  Future<void> _pickDueDate() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final initial = _dueDate ?? today;
    final first = DateTime(2000);
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(first) ? first : initial,
      firstDate: first,
      lastDate: DateTime(2100),
    );
    if (picked == null || !mounted) return;
    setState(() => _dueDate = picked);
  }

  Future<void> _save(List<TaskTheme>? themes) async {
    if (!_canSave) return;
    setState(() => _saving = true);

    // 一覧に無いテーマ（取得失敗・削除済み）は送らない
    final themeId = themes != null && themes.any((t) => t.id == _themeId) ? _themeId : null;
    final body = buildTaskFormBody(
      title: _titleController.text,
      description: _descriptionController.text,
      priority: _priority,
      dueDate: _dueDate,
      themeId: themeId,
      isEdit: _isEdit,
    );
    final messenger = ScaffoldMessenger.of(context);
    // 保存中に画面が破棄されても invalidate できるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);
    final editing = widget.task;

    try {
      final service = ref.read(taskServiceProvider);
      if (editing == null) {
        await service.createTask(body);
      } else {
        await service.updateTask(editing.id, body);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(content: Text('タスクの保存に失敗しました: $e')),
      );
      return;
    }

    // 保存成功：データの更新は画面の生存に関係なく行う
    if (editing != null) container.invalidate(taskDetailProvider(editing.id));
    container.invalidate(taskListProvider);

    // ここから先は画面操作なので生存確認する
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(content: Text(editing == null ? 'タスクを作成しました' : 'タスクを更新しました')),
    );
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(AppRoutes.tasks);
    }
  }

  @override
  Widget build(BuildContext context) {
    final themesAsync = ref.watch(themeListProvider);
    final themes = themesAsync.valueOrNull;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'タスクを編集' : '新しいタスク'),
        actions: const [VoiceModeIndicator()],
      ),
      body: VoiceScrollTarget(
        path: _isEdit ? AppRoutes.taskEdit : AppRoutes.taskNew,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextField(
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'タイトル',
                hintText: 'タスクのタイトルを入力',
              ),
              autofocus: !_isEdit && !_openedByVoice,
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _descriptionController,
              decoration: const InputDecoration(
                labelText: '説明（任意）',
                hintText: 'タスクの説明を入力',
                alignLabelWithHint: true,
              ),
              minLines: 3,
              maxLines: 6,
            ),
            const SizedBox(height: 24),
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
            const SizedBox(height: 24),
            InkWell(
              onTap: _pickDueDate,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: '期限',
                  prefixIcon: const Icon(Icons.calendar_today),
                  suffixIcon: _dueDate != null
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          tooltip: '期限をクリア',
                          onPressed: () => setState(() => _dueDate = null),
                        )
                      : null,
                ),
                child: Text(
                  _dueDate != null ? DateFormatter.formatDate(_dueDate) : '未設定',
                ),
              ),
            ),
            if (themes != null && themes.isNotEmpty) ...[
              const SizedBox(height: 16),
              _ThemeDropdown(
                themes: themes,
                value: themes.any((t) => t.id == _themeId) ? _themeId : null,
                onChanged: (value) => setState(() => _themeId = value),
              ),
            ] else if (themesAsync.isLoading) ...[
              const SizedBox(height: 16),
              const LinearProgressIndicator(),
            ],
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _canSave ? () => _save(themes) : null,
              child: _saving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(_isEdit ? '保存' : '作成'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThemeDropdown extends StatelessWidget {
  final List<TaskTheme> themes;
  final String? value;
  final ValueChanged<String?> onChanged;

  const _ThemeDropdown({
    required this.themes,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: const InputDecoration(
        labelText: 'テーマ',
        prefixIcon: Icon(Icons.folder),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String?>(
          value: value,
          isExpanded: true,
          isDense: true,
          items: [
            const DropdownMenuItem<String?>(
              value: null,
              child: Text('なし'),
            ),
            for (final theme in themes)
              DropdownMenuItem<String?>(
                value: theme.id,
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(
                        color: ColorUtils.parseColor(theme.color) ?? Colors.grey,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(theme.name, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
              ),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }
}
