import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/note_paths.dart';
import '../../models/note.dart';
import '../../providers/note_provider.dart';
import '../../providers/service_providers.dart';
import '../../utils/date_formatter.dart';
import '../../widgets/centered_message.dart';
import '../../widgets/swipe_to_delete.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';

/// ノート一覧（全ノート）。並びはサーバーのまま（ピン留め優先・更新の新しい順）。
/// 追加は AppBar の＋、削除は行の横スワイプ（右から左）＋確認ダイアログ（バックログ一覧と同じ方式）。
class NotesScreen extends ConsumerStatefulWidget {
  const NotesScreen({super.key});

  @override
  ConsumerState<NotesScreen> createState() => _NotesScreenState();
}

class _NotesScreenState extends ConsumerState<NotesScreen> {
  /// 削除リクエスト中のノート id（二重実行防止）
  final Set<String> _deleting = {};

  /// スワイプで消えた行の id。再取得の結果が届くまで一覧から外しておく
  /// （Dismissible は消えた後も木に残るとエラーになるため）。
  final Set<String> _dismissed = {};

  /// スワイプ削除の確認→削除。削除できたら true（行が消える）、
  /// キャンセル・失敗・実行中なら false（行はスワイプ前に戻る）。
  Future<bool> _delete(Note note) async {
    if (_deleting.contains(note.id)) return false;
    final linked = note.linkedTaskIds.isEmpty ? '' : '紐づくタスクの資料からも外れます。';
    final ok = await confirmBacklogDelete(
      context,
      '「${note.displayTitle}」を削除します。$linked元に戻せません。',
    );
    if (!ok || !mounted) return false;

    setState(() => _deleting.add(note.id));
    final messenger = ScaffoldMessenger.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await ref.read(noteServiceProvider).deleteNote(note.id);
    } catch (e) {
      if (mounted) setState(() => _deleting.remove(note.id));
      messenger.showSnackBar(SnackBar(content: Text('ノートの削除に失敗しました: $e')));
      return false;
    }
    invalidateNoteCaches(container, note.id, note.linkedTaskIds);
    if (mounted) setState(() => _deleting.remove(note.id));
    messenger.showSnackBar(const SnackBar(content: Text('ノートを削除しました')));
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final notesAsync = ref.watch(noteListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('ノート'),
        actions: [
          const VoiceModeIndicator(trailing: false),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'ノートを追加',
            onPressed: () => context.push(NotePaths.createPath()),
          ),
        ],
      ),
      body: VoiceScrollTarget(
        path: NotePaths.list,
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(noteListProvider);
            try {
              await ref.read(noteListProvider.future);
            } catch (_) {}
          },
          child: notesAsync.when(
            data: (fetched) {
              final notes = fetched.where((n) => !_dismissed.contains(n.id)).toList();
              if (notes.isEmpty) {
                return const CenteredMessage(
                  icon: Icons.description_outlined,
                  message: 'ノートはまだありません',
                );
              }
              return ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.only(bottom: 16),
                itemCount: notes.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final note = notes[index];
                  return BacklogSwipeToDelete(
                    itemKey: ValueKey('note-${note.id}'),
                    deleting: _deleting.contains(note.id),
                    onConfirmDelete: () => _delete(note),
                    onDismissed: () => setState(() => _dismissed.add(note.id)),
                    child: NoteListTile(note: note),
                  );
                },
              );
            },
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (_, __) => CenteredMessage(
              icon: Icons.error_outline,
              iconColor: Colors.red,
              message: 'ノートの取得に失敗しました',
              action: ElevatedButton(
                onPressed: () => ref.invalidate(noteListProvider),
                child: const Text('再試行'),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 本文の先頭の、見出し・箇条書きの記号を落とした1行（一覧の下見用）
String notePreviewLine(String content) {
  for (final raw in content.split('\n')) {
    final line = raw.trim();
    if (line.isEmpty || line.startsWith('```')) continue;
    final text = line.replaceFirst(RegExp(r'^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+\.\s+)'), '').trim();
    if (text.isNotEmpty) return text;
  }
  return '';
}

/// ノート一覧の1行（タイトル、本文の下見、種類・更新日時・紐づくタスク数、ピン留め）。
/// 削除は行のスワイプで行う
class NoteListTile extends StatelessWidget {
  final Note note;

  const NoteListTile({super.key, required this.note});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant);
    final preview = notePreviewLine(note.content);
    final meta = [
      if (note.docType != null) note.docType!,
      if (note.updatedAt != null) '${DateFormatter.formatDateTime(note.updatedAt)} 更新',
      if (note.linkedTaskIds.isNotEmpty) 'タスク ${note.linkedTaskIds.length}件',
    ].join(' · ');
    return ListTile(
      leading: Icon(Icons.description_outlined, color: scheme.primary),
      title: Text(note.displayTitle, maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: preview.isEmpty && meta.isEmpty
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (preview.isNotEmpty) Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis),
                if (meta.isNotEmpty) Text(meta, style: muted),
              ],
            ),
      trailing: note.isPinned
          ? Icon(Icons.push_pin, size: 18, color: scheme.onSurfaceVariant, semanticLabel: 'ピン留め')
          : null,
      onTap: () => context.push(NotePaths.detailPath(note.id)),
    );
  }
}
