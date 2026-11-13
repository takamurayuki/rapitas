import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/note_paths.dart';
import '../../models/note.dart';
import '../../providers/note_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../services/note_service.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/voice_mode_indicator.dart';

/// ノートの新規作成（/notes/new）と編集（/notes/:id/edit）。書けるのはタイトルと本文（Markdown）だけ。
///
/// 保存は PUT /notes/:id。新規の id は画面を開いたときに一度だけ決めるので、保存を押し直しても
/// 同じノートの上書きになる（二重にできない）。[taskId] 付きで開いたとき（タスク詳細の「資料」節から）は、
/// 保存の後にそのタスクへ紐づける（POST /notes/:id/links）。紐づけだけ失敗したらこの画面に残り、
/// もう一度「保存」を押せばやり直せる（保存も紐づけも上書きなので、繰り返しても壊れない）。
///
/// 種類・色・タグ・ピン留めは v1 では編集しない（送らないので、デスクトップで付けた値は残る）。
class NoteFormScreen extends ConsumerStatefulWidget {
  /// 編集するノートの id。null なら新規作成
  final String? noteId;

  /// 新規作成の後に紐づけるタスクの id
  final String? taskId;

  const NoteFormScreen({super.key, this.noteId, this.taskId});

  @override
  ConsumerState<NoteFormScreen> createState() => _NoteFormScreenState();
}

class _NoteFormScreenState extends ConsumerState<NoteFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _titleController = TextEditingController();
  final _contentController = TextEditingController();

  /// 保存先の id（新規なら開いたときに決めたもの）
  late final String _id = widget.noteId ?? NoteService.newNoteId();
  bool get _isEdit => widget.noteId != null;

  /// 編集で、読み込んだノートを入力欄に入れたか（読み直しで入力中の文字を上書きしない）
  bool _filled = false;

  /// 読み込んだ（保存した）ノートが紐づいているタスク。保存後に資料節を読み直す
  List<String> _linkedTaskIds = const [];
  bool _saving = false;

  @override
  void dispose() {
    _titleController.dispose();
    _contentController.dispose();
    super.dispose();
  }

  void _fill(Note note) {
    if (_filled) return;
    _filled = true;
    _titleController.text = note.title;
    _contentController.text = note.content;
    _linkedTaskIds = note.linkedTaskIds;
  }

  Future<void> _save() async {
    if (_saving) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _saving = true);
    final service = ref.read(noteServiceProvider);
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    final taskId = widget.taskId;
    final themeName =
        taskId == null ? null : ref.read(taskDetailProvider(taskId)).valueOrNull?.theme?.name;

    final Note saved;
    try {
      saved = await service.saveNote(_id, title: _titleController.text.trim(), content: _contentController.text);
    } catch (e) {
      if (mounted) setState(() => _saving = false);
      messenger.showSnackBar(SnackBar(content: Text('ノートの保存に失敗しました: $e')));
      return;
    }
    _linkedTaskIds = saved.linkedTaskIds;

    if (taskId != null && !saved.linkedTaskIds.contains(taskId)) {
      try {
        await service.linkNote(_id, taskId, themeName: themeName);
      } catch (e) {
        invalidateNoteCaches(container, _id, _linkedTaskIds);
        if (mounted) setState(() => _saving = false);
        messenger.showSnackBar(SnackBar(
          content: Text('ノートは保存しましたが、タスクへの紐づけに失敗しました。もう一度「保存」を押してください: $e'),
        ));
        return;
      }
    }

    invalidateNoteCaches(container, _id, {..._linkedTaskIds, if (taskId != null) taskId});
    if (!mounted) return;
    messenger.showSnackBar(SnackBar(content: Text(_isEdit ? 'ノートを保存しました' : 'ノートを作成しました')));
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(NotePaths.detailPath(_id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'ノートを編集' : '新しいノート'),
        actions: const [VoiceModeIndicator()],
      ),
      body: _isEdit ? _buildEditBody() : _buildForm(),
    );
  }

  Widget _buildEditBody() {
    final noteAsync = ref.watch(noteDetailProvider(_id));
    // 一度入力欄に入れた後は、読み直し中でも入力中の内容を出し続ける
    if (_filled) return _buildForm();
    return noteAsync.when(
      data: (note) {
        if (note == null) {
          return const CenteredMessage(
            icon: Icons.search_off,
            message: 'ノートが見つかりませんでした。\n削除された可能性があります。',
          );
        }
        _fill(note);
        return _buildForm();
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => CenteredMessage(
        icon: Icons.error_outline,
        iconColor: Colors.red,
        message: 'ノートの取得に失敗しました',
        action: ElevatedButton(
          onPressed: () => ref.invalidate(noteDetailProvider(_id)),
          child: const Text('再試行'),
        ),
      ),
    );
  }

  Widget _buildForm() {
    final theme = Theme.of(context);
    final taskId = widget.taskId;
    final taskTitle = taskId == null ? null : ref.watch(taskDetailProvider(taskId)).valueOrNull?.title;
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (taskId != null) ...[
            Row(
              key: const ValueKey('note-form-link-target'),
              children: [
                Icon(Icons.task_outlined, size: 18, color: theme.colorScheme.onSurfaceVariant),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '保存すると「${taskTitle ?? 'タスク #$taskId'}」の資料に追加します',
                    style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
          TextFormField(
            key: const ValueKey('note-form-title'),
            controller: _titleController,
            decoration: const InputDecoration(labelText: 'タイトル', hintText: '例: 画面設計メモ'),
            maxLength: 300, // バックエンドの MAX_NOTE_TITLE と同じ
            textInputAction: TextInputAction.next,
            enabled: !_saving,
          ),
          const SizedBox(height: 8),
          TextFormField(
            key: const ValueKey('note-form-content'),
            controller: _contentController,
            decoration: const InputDecoration(
              labelText: '本文（Markdown）',
              hintText: '# 見出し\n- 箇条書き',
              alignLabelWithHint: true,
            ),
            minLines: 10,
            maxLines: null,
            keyboardType: TextInputType.multiline,
            enabled: !_saving,
            // デスクトップは無題のノートも作れるが、タイトルも本文も空のノートは作らせない
            validator: (value) =>
                (value ?? '').trim().isEmpty && _titleController.text.trim().isEmpty
                    ? 'タイトルか本文を入力してください'
                    : null,
          ),
          const SizedBox(height: 24),
          FilledButton(
            key: const ValueKey('note-form-save'),
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('保存'),
          ),
        ],
      ),
    );
  }
}
