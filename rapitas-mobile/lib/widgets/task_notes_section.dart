import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../config/routes.dart';
import '../models/note.dart';
import '../providers/note_provider.dart';
import '../utils/date_formatter.dart';

/// タスク詳細の「資料」節。そのタスクに紐づくノートを、サーバーの並び
/// （ピン留め優先・更新の新しい順）のまま出し、タップでノート詳細へ進む。
///
/// NOTE: 読み込み中はくるくる回る表示を使わない。タスク詳細のテストは pumpAndSettle で
/// 落ち着くのを待つので、終わらないアニメーションを置くとそれらが全部タイムアウトする。
class TaskNotesSection extends ConsumerWidget {
  final String taskId;

  const TaskNotesSection({super.key, required this.taskId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final notesAsync = ref.watch(taskNotesProvider(taskId));
    final notes = notesAsync.valueOrNull;

    return Column(
      key: const ValueKey('task-notes-section'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          notes == null || notes.isEmpty ? '資料' : '資料 (${notes.length})',
          style: theme.textTheme.titleSmall,
        ),
        const SizedBox(height: 8),
        if (notes != null)
          if (notes.isEmpty)
            Text('このタスクの資料はまだありません。', style: muted)
          else
            for (final note in notes) TaskNoteTile(note: note)
        else if (notesAsync.hasError)
          Row(
            children: [
              Expanded(child: Text('資料を読み込めませんでした。', style: muted)),
              TextButton(
                onPressed: () => ref.invalidate(taskNotesProvider(taskId)),
                // 文字の大きさは Text 側に置く（styleFrom(textStyle:) は画面キャプチャで字が化ける）
                child: const Text('再読み込み'),
              ),
            ],
          )
        else
          Text('読み込み中…', style: muted),
      ],
    );
  }
}

/// 「資料」節の1行（タイトル、種類・更新日時、ピン留め）
class TaskNoteTile extends StatelessWidget {
  final Note note;

  const TaskNoteTile({super.key, required this.note});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final updated = note.updatedAt == null ? null : '${DateFormatter.formatDateTime(note.updatedAt)} 更新';
    final subtitle = [if (note.docType != null) note.docType!, if (updated != null) updated].join(' · ');
    return Card(
      key: ValueKey('task-note-${note.id}'),
      child: ListTile(
        leading: Icon(Icons.description_outlined, color: scheme.primary),
        title: Text(note.displayTitle, maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: subtitle.isEmpty ? null : Text(subtitle),
        trailing: note.isPinned
            ? Icon(Icons.push_pin, size: 18, color: scheme.onSurfaceVariant, semanticLabel: 'ピン留め')
            : null,
        onTap: () => context.push(AppRoutes.noteDetailPath(note.id)),
      ),
    );
  }
}
