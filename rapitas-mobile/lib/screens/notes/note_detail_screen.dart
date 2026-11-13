import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/note.dart';
import '../../providers/note_provider.dart';
import '../../providers/task_provider.dart';
import '../../utils/date_formatter.dart';
import '../../widgets/markdown/note_content_markdown.dart';
import '../../widgets/voice_mode_indicator.dart';

/// ノート詳細（読むだけ）。タイトル・種類・タグ・紐づくタスク・本文（Markdown）を出す。
///
/// 本文の Mermaid は図にせずコードのまま見せ、図は PC で表示する旨を添える（[NoteContentMarkdown]）。
/// 編集・削除はここでは扱わない（ノートの作成・編集と合わせて AppBar に足す）。
class NoteDetailScreen extends ConsumerWidget {
  final String noteId;

  const NoteDetailScreen({super.key, required this.noteId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final noteAsync = ref.watch(noteDetailProvider(noteId));
    Future<void> reload() async => ref.invalidate(noteDetailProvider(noteId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('ノート'),
        actions: const [VoiceModeIndicator()],
      ),
      body: noteAsync.when(
        data: (note) => note == null
            ? _Message(
                icon: Icons.search_off,
                text: 'ノートが見つかりませんでした。\n削除された可能性があります。',
                onRetry: reload,
              )
            : RefreshIndicator(
                onRefresh: reload,
                child: _NoteBody(note: note),
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _Message(
          icon: Icons.error_outline,
          text: 'ノートの取得に失敗しました',
          onRetry: reload,
        ),
      ),
    );
  }
}

class _NoteBody extends StatelessWidget {
  final Note note;

  const _NoteBody({required this.note});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant);
    final hasMeta = note.docType != null || note.isPinned || note.tags.isNotEmpty;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          note.displayTitle,
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
        ),
        if (note.updatedAt != null) ...[
          const SizedBox(height: 4),
          Text('${DateFormatter.formatDateTime(note.updatedAt)} 更新', style: muted),
        ],
        if (hasMeta) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (note.isPinned)
                const _MetaChip(icon: Icons.push_pin, label: 'ピン留め'),
              if (note.docType != null)
                _MetaChip(icon: Icons.description_outlined, label: note.docType!),
              for (final tag in note.tags) _MetaChip(label: '#$tag'),
            ],
          ),
        ],
        if (note.linkedTaskIds.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('紐づくタスク', style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          for (final taskId in note.linkedTaskIds)
            _LinkedTaskTile(taskId: taskId, meta: note.linkedTaskMeta[taskId]),
        ],
        const Divider(height: 32),
        if (note.content.trim().isEmpty)
          Text('本文はありません。', style: muted)
        else
          NoteContentMarkdown(data: note.content),
      ],
    );
  }
}

class _MetaChip extends StatelessWidget {
  final IconData? icon;
  final String label;

  const _MetaChip({this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Chip(
      avatar: icon == null ? null : Icon(icon, size: 16, color: scheme.onSurfaceVariant),
      label: Text(label),
      visualDensity: VisualDensity.compact,
    );
  }
}

/// 紐づくタスク1件。タイトルはタスク詳細のキャッシュから引き、取れなければ番号で出す
class _LinkedTaskTile extends ConsumerWidget {
  final String taskId;
  final NoteTaskMeta? meta;

  const _LinkedTaskTile({required this.taskId, this.meta});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final title = ref.watch(taskDetailProvider(taskId)).valueOrNull?.title;
    final linkContext = [meta?.projectName, meta?.themeName, meta?.parentTaskTitle]
        .whereType<String>()
        .join(' / ');
    return ListTile(
      key: ValueKey('note-linked-task-$taskId'),
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: const Icon(Icons.task_outlined),
      title: Text(title ?? 'タスク #$taskId', maxLines: 2, overflow: TextOverflow.ellipsis),
      subtitle: linkContext.isEmpty ? null : Text(linkContext),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push('/tasks/$taskId'),
    );
  }
}

class _Message extends StatelessWidget {
  final IconData icon;
  final String text;
  final Future<void> Function() onRetry;

  const _Message({required this.icon, required this.text, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 64, color: Theme.of(context).colorScheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(text, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            ElevatedButton(onPressed: onRetry, child: const Text('再試行')),
          ],
        ),
      ),
    );
  }
}
